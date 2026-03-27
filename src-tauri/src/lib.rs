mod db;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use uuid::Uuid;

// ── Preview Server State ──

type LogBuffer = Arc<Mutex<Vec<String>>>;

struct PreviewProcess {
    child: Child,
    stdout_buf: LogBuffer,
    stderr_buf: LogBuffer,
}

struct PreviewState(Mutex<HashMap<String, PreviewProcess>>);

// ── Ship Cancel State ──

struct ShipHandle {
    cancelled: Arc<AtomicBool>,
    /// PID of the currently running child process (npm, vite, tauri build)
    current_pid: Arc<Mutex<Option<u32>>>,
}

struct ShipCancelState(Mutex<HashMap<String, ShipHandle>>);

// ── Blue-Engine State ──

struct BlueEngineProcess {
    child: Child,
    port: u16,
    invoke_key: String,
    /// Handle for the stderr log-streaming thread (if any).
    _log_thread: Option<std::thread::JoinHandle<()>>,
}

struct BlueEngineState(Mutex<HashMap<String, BlueEngineProcess>>);

const MAX_LOG_LINES: usize = 200;

/// Spawn a thread that reads lines from a reader and appends to a shared buffer.
fn spawn_log_reader<R: std::io::Read + Send + 'static>(reader: R, buf: LogBuffer) {
    std::thread::spawn(move || {
        let br = BufReader::new(reader);
        for line in br.lines() {
            match line {
                Ok(l) => {
                    if let Ok(mut v) = buf.lock() {
                        v.push(l);
                        if v.len() > MAX_LOG_LINES {
                            v.remove(0);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

// ── Types ──

#[derive(Deserialize)]
struct FileEntry {
    path: String,
    content: String,
}

#[derive(Serialize)]
struct InitProjectResult {
    project_root: String,
    app_root: String,
}

#[derive(Serialize)]
struct StageFilesResult {
    staged_paths: Vec<String>,
}

#[derive(Serialize)]
struct ApplyCheckpointResult {
    snapshot_id: String,
    applied_paths: Vec<String>,
}

// ── Helpers ──

fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    Ok(data_dir.join("raincast-workspace"))
}

fn project_root(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    validate_segment(project_id)?;
    Ok(workspace_root(app)?.join(project_id))
}

fn validate_segment(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("Path segment cannot be empty".into());
    }
    if s.contains("..") || s.contains('/') || s.contains('\\') {
        return Err(format!("Invalid path segment: {s}"));
    }
    Ok(())
}

/// Reject absolute paths and ".." traversal.
fn safe_resolve(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err(format!("Absolute paths not allowed: {relative}"));
    }
    for component in rel.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err(format!("Parent traversal not allowed: {relative}"));
            }
            std::path::Component::RootDir => {
                return Err(format!("Root dir not allowed: {relative}"));
            }
            _ => {}
        }
    }
    let resolved = base.join(rel);
    // Double-check it's still under base
    if !resolved.starts_with(base) {
        return Err(format!("Path escapes base directory: {relative}"));
    }
    Ok(resolved)
}

/// Write content to a file atomically: write to a temp file, then rename.
fn atomic_write(target: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directory {}: {e}", parent.display()))?;
    }
    let tmp = target.with_extension("tmp");
    let mut file =
        fs::File::create(&tmp).map_err(|e| format!("Cannot create temp file: {e}"))?;
    file.write_all(content)
        .map_err(|e| format!("Cannot write temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Cannot sync temp file: {e}"))?;
    fs::rename(&tmp, target)
        .map_err(|e| format!("Cannot rename temp→target: {e}"))?;
    Ok(())
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ts:x}")
}

// ── Tauri Commands ──

/// Create the workspace directories for a project.
#[tauri::command]
fn init_project(app: tauri::AppHandle, project_id: String) -> Result<InitProjectResult, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");
    let stage_dir = root.join(".rain").join("stage");
    let snap_dir = root.join(".rain").join("snapshots");

    fs::create_dir_all(&app_root)
        .map_err(|e| format!("Cannot create app root: {e}"))?;
    fs::create_dir_all(&stage_dir)
        .map_err(|e| format!("Cannot create stage dir: {e}"))?;
    fs::create_dir_all(&snap_dir)
        .map_err(|e| format!("Cannot create snapshots dir: {e}"))?;

    // Seed package.json if missing (ensures TypeScript is available for validation)
    let pkg_json = app_root.join("package.json");
    if !pkg_json.exists() {
        let seed_pkg = r#"{
  "name": "raincast-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.8.0",
    "vite": "^6.0.0"
  }
}
"#;
        atomic_write(&pkg_json, seed_pkg.as_bytes())?;
    }

    // Seed tsconfig.json if missing
    let tsconfig = app_root.join("tsconfig.json");
    if !tsconfig.exists() {
        let seed_tsconfig = r#"{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src"]
}
"#;
        atomic_write(&tsconfig, seed_tsconfig.as_bytes())?;
    }

    // Seed vite.config.ts if missing
    let vite_config = app_root.join("vite.config.ts");
    if !vite_config.exists() {
        let seed_vite = r#"import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
"#;
        atomic_write(&vite_config, seed_vite.as_bytes())?;
    }

    // Seed src/main.tsx if missing
    let src_dir = app_root.join("src");
    fs::create_dir_all(&src_dir)
        .map_err(|e| format!("Cannot create src dir: {e}"))?;
    let main_tsx = src_dir.join("main.tsx");
    if !main_tsx.exists() {
        let seed_main = r#"import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"#;
        atomic_write(&main_tsx, seed_main.as_bytes())?;
    }

    // Seed index.html if missing
    let index_html = app_root.join("index.html");
    if !index_html.exists() {
        let seed_html = r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#;
        atomic_write(&index_html, seed_html.as_bytes())?;
    }

    Ok(InitProjectResult {
        project_root: root.to_string_lossy().into_owned(),
        app_root: app_root.to_string_lossy().into_owned(),
    })
}

/// Stage generated files into `.rain/stage/<genId>/`.
#[tauri::command]
fn stage_files(
    app: tauri::AppHandle,
    project_id: String,
    gen_id: String,
    files: Vec<FileEntry>,
) -> Result<StageFilesResult, String> {
    let root = project_root(&app, &project_id)?;
    validate_segment(&gen_id)?;
    let stage_base = root.join(".rain").join("stage").join(&gen_id);

    let mut staged = Vec::new();

    for f in &files {
        let target = safe_resolve(&stage_base, &f.path)?;
        atomic_write(&target, f.content.as_bytes())?;
        staged.push(f.path.clone());
    }

    Ok(StageFilesResult {
        staged_paths: staged,
    })
}

/// Apply a checkpoint: snapshot existing files, then copy staged files into `app/`.
#[tauri::command]
fn apply_checkpoint(
    app: tauri::AppHandle,
    project_id: String,
    gen_id: String,
    paths: Vec<String>,
) -> Result<ApplyCheckpointResult, String> {
    let root = project_root(&app, &project_id)?;
    validate_segment(&gen_id)?;

    let app_root = root.join("app");
    let stage_base = root.join(".rain").join("stage").join(&gen_id);
    let snapshot_id = format!("snap-{}", generate_id());
    let snap_dir = root.join(".rain").join("snapshots").join(&snapshot_id);
    let snap_files_dir = snap_dir.join("files");

    fs::create_dir_all(&snap_files_dir)
        .map_err(|e| format!("Cannot create snapshot dir: {e}"))?;

    // Snapshot manifest: record which files were backed up
    let mut manifest_entries: Vec<serde_json::Value> = Vec::new();
    let mut applied = Vec::new();

    for rel_path in &paths {
        let app_file = safe_resolve(&app_root, rel_path)?;
        let staged_file = safe_resolve(&stage_base, rel_path)?;

        // Check staged file exists
        if !staged_file.exists() {
            return Err(format!("Staged file not found: {rel_path}"));
        }

        // Snapshot the original if it exists
        let existed = app_file.exists();
        if existed {
            let snap_target = safe_resolve(&snap_files_dir, rel_path)?;
            if let Some(parent) = snap_target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create snapshot subdir: {e}"))?;
            }
            fs::copy(&app_file, &snap_target)
                .map_err(|e| format!("Cannot snapshot {rel_path}: {e}"))?;
        }

        manifest_entries.push(serde_json::json!({
            "path": rel_path,
            "existed": existed,
        }));

        // Copy staged → app (atomic)
        let content = fs::read(&staged_file)
            .map_err(|e| format!("Cannot read staged {rel_path}: {e}"))?;
        atomic_write(&app_file, &content)?;

        applied.push(rel_path.clone());
    }

    // Write snapshot manifest
    let manifest = serde_json::json!({
        "snapshotId": snapshot_id,
        "genId": gen_id,
        "projectId": project_id,
        "files": manifest_entries,
    });
    let manifest_path = snap_dir.join("manifest.json");
    atomic_write(&manifest_path, manifest.to_string().as_bytes())?;

    Ok(ApplyCheckpointResult {
        snapshot_id,
        applied_paths: applied,
    })
}

/// Rollback: restore files from a snapshot.
#[tauri::command]
fn rollback_snapshot(
    app: tauri::AppHandle,
    project_id: String,
    snapshot_id: String,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    validate_segment(&snapshot_id)?;

    let snap_dir = root.join(".rain").join("snapshots").join(&snapshot_id);
    let manifest_path = snap_dir.join("manifest.json");
    let snap_files_dir = snap_dir.join("files");
    let app_root = root.join("app");

    // Read manifest
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Cannot read snapshot manifest: {e}"))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Cannot parse snapshot manifest: {e}"))?;

    let files = manifest["files"]
        .as_array()
        .ok_or("Invalid snapshot manifest: missing files array")?;

    for entry in files {
        let rel_path = entry["path"]
            .as_str()
            .ok_or("Invalid file entry in snapshot manifest")?;
        let existed = entry["existed"].as_bool().unwrap_or(false);
        let app_file = safe_resolve(&app_root, rel_path)?;

        if existed {
            // Restore from snapshot
            let snap_file = safe_resolve(&snap_files_dir, rel_path)?;
            if snap_file.exists() {
                let content = fs::read(&snap_file)
                    .map_err(|e| format!("Cannot read snapshot file {rel_path}: {e}"))?;
                atomic_write(&app_file, &content)?;
            }
        } else {
            // File didn't exist before — remove it
            if app_file.exists() {
                fs::remove_file(&app_file)
                    .map_err(|e| format!("Cannot remove {rel_path}: {e}"))?;
            }
        }
    }

    Ok(())
}

/// Reapply: re-apply staged files from a snapshot's original generation.
/// This is the reverse of rollback — it copies the staged files back into `app/`.
#[tauri::command]
fn reapply_snapshot(
    app: tauri::AppHandle,
    project_id: String,
    snapshot_id: String,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    validate_segment(&snapshot_id)?;

    let snap_dir = root.join(".rain").join("snapshots").join(&snapshot_id);
    let manifest_path = snap_dir.join("manifest.json");
    let app_root = root.join("app");

    // Read manifest to get genId and file paths
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Cannot read snapshot manifest: {e}"))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Cannot parse snapshot manifest: {e}"))?;

    let gen_id = manifest["genId"]
        .as_str()
        .ok_or("Invalid snapshot manifest: missing genId")?;
    let stage_base = root.join(".rain").join("stage").join(gen_id);

    let files = manifest["files"]
        .as_array()
        .ok_or("Invalid snapshot manifest: missing files array")?;

    for entry in files {
        let rel_path = entry["path"]
            .as_str()
            .ok_or("Invalid file entry in snapshot manifest")?;
        let app_file = safe_resolve(&app_root, rel_path)?;
        let staged_file = safe_resolve(&stage_base, rel_path)?;

        if !staged_file.exists() {
            return Err(format!("Staged file no longer exists: {rel_path}"));
        }

        // Re-copy staged → app (atomic)
        let content = fs::read(&staged_file)
            .map_err(|e| format!("Cannot read staged {rel_path}: {e}"))?;
        atomic_write(&app_file, &content)?;
    }

    Ok(())
}

// ── Validation Command ──

const ALLOWED_COMMANDS: &[&str] = &[
    "npx tsc --noEmit",
    "npm run build",
    "npm run lint",
    "npm install",
    "cargo check",
];

#[derive(Serialize)]
struct ValidationResult {
    ok: bool,
    exit_code: i32,
    stdout_tail: Vec<String>,
    stderr_tail: Vec<String>,
}

#[tauri::command]
async fn run_validation(
    app: tauri::AppHandle,
    project_id: String,
    commands: Vec<String>,
) -> Result<ValidationResult, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    if !app_root.exists() {
        return Err("App root does not exist.".into());
    }

    // Validate all commands against allowlist (cheap, stays on main thread)
    for cmd in &commands {
        let trimmed = cmd.trim();
        if !ALLOWED_COMMANDS.iter().any(|allowed| trimmed.starts_with(allowed)) {
            return Err(format!("Command not allowed: {trimmed}"));
        }
    }

    // Run the actual subprocess work off the main thread so the UI stays responsive
    tauri::async_runtime::spawn_blocking(move || {
        let mut combined_stdout: Vec<String> = Vec::new();
        let mut combined_stderr: Vec<String> = Vec::new();
        let mut last_exit_code: i32 = 0;

        for cmd in &commands {
            let trimmed = cmd.trim();
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }

            // cargo commands run from src-tauri/ subdirectory
            let work_dir = if parts[0] == "cargo" {
                app_root.join("src-tauri")
            } else {
                app_root.clone()
            };

            let output = Command::new(parts[0])
                .args(&parts[1..])
                .current_dir(&work_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| format!("Failed to run '{}': {e}", trimmed))?;

            last_exit_code = output.status.code().unwrap_or(1);

            // Collect stdout lines
            for line in BufReader::new(&output.stdout[..]).lines() {
                if let Ok(l) = line {
                    combined_stdout.push(l);
                }
            }

            // Collect stderr lines
            for line in BufReader::new(&output.stderr[..]).lines() {
                if let Ok(l) = line {
                    combined_stderr.push(l);
                }
            }

            // Stop on first failing command
            if last_exit_code != 0 {
                break;
            }
        }

        // Keep only last MAX_LOG_LINES
        if combined_stdout.len() > MAX_LOG_LINES {
            combined_stdout = combined_stdout.split_off(combined_stdout.len() - MAX_LOG_LINES);
        }
        if combined_stderr.len() > MAX_LOG_LINES {
            combined_stderr = combined_stderr.split_off(combined_stderr.len() - MAX_LOG_LINES);
        }

        Ok(ValidationResult {
            ok: last_exit_code == 0,
            exit_code: last_exit_code,
            stdout_tail: combined_stdout,
            stderr_tail: combined_stderr,
        })
    })
    .await
    .map_err(|e| format!("Validation task panicked: {e}"))?
}

// ── Bridge Commands (relayed from iframe via PreviewPane postMessage) ──

#[derive(Serialize)]
struct DirEntry {
    name: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
}

#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
}

#[derive(Serialize)]
struct SystemInfo {
    os: String,          // "macos", "windows", "linux"
    arch: String,        // "aarch64", "x86_64"
    home_dir: String,
    desktop_dir: String,
    documents_dir: String,
    downloads_dir: String,
    username: String,
}

/// Read a text file from the project's app directory.
/// Path is relative to app root — no escape allowed.
#[tauri::command]
fn bridge_read_file(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<String, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");
    let target = safe_resolve(&app_root, &path)?;
    fs::read_to_string(&target)
        .map_err(|e| format!("Cannot read {path}: {e}"))
}

/// Write a text file to the project's app directory.
#[tauri::command]
fn bridge_write_file(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");
    let target = safe_resolve(&app_root, &path)?;
    atomic_write(&target, content.as_bytes())
}

/// Delete a file within the project's app directory.
#[tauri::command]
fn bridge_delete_file(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");
    let target = safe_resolve(&app_root, &path)?;
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("Cannot delete {path}: {e}"))?;
    }
    Ok(())
}

/// List directory entries under the project's app directory.
#[tauri::command]
fn bridge_list_dir(
    app: tauri::AppHandle,
    project_id: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");
    let target = safe_resolve(&app_root, &path)?;

    let entries = fs::read_dir(&target)
        .map_err(|e| format!("Cannot list {path}: {e}"))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read entry: {e}"))?;
        let meta = entry.metadata().map_err(|e| format!("Cannot read metadata: {e}"))?;
        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
        });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

// ── Project Grep ──

#[derive(Serialize, Clone)]
struct GrepMatch {
    file: String,
    line: usize,
    text: String,
}

/// Search for a substring pattern across source files in the project.
/// Walks src/ recursively, reads .ts/.tsx/.css/.json files, returns matching lines.
#[tauri::command]
fn bridge_grep_files(
    app: tauri::AppHandle,
    project_id: String,
    pattern: String,
    file_glob: Option<String>,
    max_results: Option<usize>,
) -> Result<Vec<GrepMatch>, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    let max = max_results.unwrap_or(50);
    let glob_ext: Option<String> = file_glob.as_ref().and_then(|g| {
        // Extract extension from simple globs like "*.ts" or "*.tsx"
        if g.starts_with("*.") {
            Some(g[1..].to_string()) // ".ts", ".tsx"
        } else {
            None
        }
    });

    let mut matches = Vec::new();

    // Walk frontend src/
    let src_root = app_root.join("src");
    if src_root.exists() {
        grep_walk(&src_root, &app_root, &pattern, &glob_ext, max, &mut matches)?;
    }

    // Walk Rust src-tauri/src/
    let tauri_src = app_root.join("src-tauri").join("src");
    if tauri_src.exists() && matches.len() < max {
        grep_walk(&tauri_src, &app_root, &pattern, &glob_ext, max, &mut matches)?;
    }

    Ok(matches)
}

fn grep_walk(
    dir: &Path,
    app_root: &Path,
    pattern: &str,
    glob_ext: &Option<String>,
    max: usize,
    matches: &mut Vec<GrepMatch>,
) -> Result<(), String> {
    if matches.len() >= max {
        return Ok(());
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Cannot read dir: {e}"))?;

    for entry in entries {
        if matches.len() >= max {
            break;
        }
        let entry = entry.map_err(|e| format!("Cannot read entry: {e}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if path.is_dir() {
            if name != "node_modules" && name != ".rain" && name != "dist" {
                grep_walk(&path, app_root, pattern, glob_ext, max, matches)?;
            }
            continue;
        }

        // Check file extension
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let matches_ext = match glob_ext {
            Some(g) => format!(".{ext}") == *g,
            None => matches!(ext, "ts" | "tsx" | "css" | "json" | "rs"),
        };
        if !matches_ext {
            continue;
        }

        // Read and search
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let rel_path = path
            .strip_prefix(app_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        for (i, line) in content.lines().enumerate() {
            if matches.len() >= max {
                break;
            }
            if line.contains(pattern) {
                matches.push(GrepMatch {
                    file: rel_path.clone(),
                    line: i + 1,
                    text: line.to_string(),
                });
            }
        }
    }
    Ok(())
}

/// Read from system clipboard.
#[tauri::command]
fn bridge_clipboard_read() -> Result<String, String> {
    // Use macOS pbpaste; on other platforms this would differ
    let output = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("Clipboard read failed: {e}"))?;
    if !output.status.success() {
        return Err("Clipboard read failed".into());
    }
    String::from_utf8(output.stdout)
        .map_err(|e| format!("Clipboard content not UTF-8: {e}"))
}

/// Write to system clipboard.
#[tauri::command]
fn bridge_clipboard_write(text: String) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Clipboard write failed: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes())
            .map_err(|e| format!("Cannot write to clipboard: {e}"))?;
    }
    child.wait().map_err(|e| format!("Clipboard write failed: {e}"))?;
    Ok(())
}

/// Return basic app info.
#[tauri::command]
fn bridge_app_info() -> AppInfo {
    AppInfo {
        name: "Raincast".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

// ── Code Editor Detection ──

#[derive(Serialize, Clone)]
struct DetectedEditor {
    id: String,        // "vscode", "cursor", "zed", "file_explorer", etc.
    name: String,      // "VS Code", "Cursor", "File Explorer", etc.
    path: String,      // absolute path to the binary/app (empty for file_explorer)
    installed: bool,   // whether this editor was found on the system
}

/// Return the full list of known editors with installed=true/false.
/// The system file explorer is always appended last with installed=true.
#[tauri::command]
fn detect_editors() -> Vec<DetectedEditor> {
    let mut editors = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let checks: &[(&str, &str, &[&str])] = &[
            ("cursor", "Cursor", &["/Applications/Cursor.app", "/usr/local/bin/cursor"]),
            ("vscode", "VS Code", &["/Applications/Visual Studio Code.app", "/usr/local/bin/code"]),
            ("zed", "Zed", &["/Applications/Zed.app", "/usr/local/bin/zed"]),
            ("windsurf", "Windsurf", &["/Applications/Windsurf.app", "/usr/local/bin/windsurf"]),
            ("idea", "IntelliJ IDEA", &["/Applications/IntelliJ IDEA.app", "/Applications/IntelliJ IDEA CE.app"]),
            ("neovim", "Neovim", &["/usr/local/bin/nvim", "/opt/homebrew/bin/nvim"]),
            ("xcode", "Xcode", &["/Applications/Xcode.app"]),
        ];

        for (id, name, paths) in checks {
            let found = paths.iter().find(|p| std::path::Path::new(p).exists());
            editors.push(DetectedEditor {
                id: id.to_string(),
                name: name.to_string(),
                path: found.map(|p| p.to_string()).unwrap_or_default(),
                installed: found.is_some(),
            });
        }

        // File explorer — always available
        editors.push(DetectedEditor {
            id: "file_explorer".into(),
            name: "Finder".into(),
            path: String::new(),
            installed: true,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
        let checks: Vec<(&str, &str, Vec<String>)> = vec![
            ("cursor", "Cursor", vec![format!("{local}\\Programs\\Cursor\\Cursor.exe")]),
            ("vscode", "VS Code", vec![format!("{local}\\Programs\\Microsoft VS Code\\Code.exe")]),
            ("zed", "Zed", vec![format!("{local}\\Programs\\Zed\\zed.exe")]),
            ("windsurf", "Windsurf", vec![format!("{local}\\Programs\\Windsurf\\Windsurf.exe")]),
            ("idea", "IntelliJ IDEA", vec![format!("{program_files}\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe")]),
            ("neovim", "Neovim", vec!["C:\\Program Files\\Neovim\\bin\\nvim.exe".into()]),
            ("xcode", "Xcode", vec![]),
        ];

        for (id, name, paths) in &checks {
            let found = paths.iter().find(|p| std::path::Path::new(p.as_str()).exists());
            editors.push(DetectedEditor {
                id: id.to_string(),
                name: name.to_string(),
                path: found.cloned().unwrap_or_default(),
                installed: found.is_some(),
            });
        }

        editors.push(DetectedEditor {
            id: "file_explorer".into(),
            name: "File Explorer".into(),
            path: String::new(),
            installed: true,
        });
    }

    #[cfg(target_os = "linux")]
    {
        let checks: &[(&str, &str, &[&str])] = &[
            ("cursor", "Cursor", &["/usr/bin/cursor", "/usr/local/bin/cursor"]),
            ("vscode", "VS Code", &["/usr/bin/code", "/usr/share/code/code"]),
            ("zed", "Zed", &["/usr/bin/zed", "/usr/local/bin/zed"]),
            ("windsurf", "Windsurf", &["/usr/bin/windsurf"]),
            ("idea", "IntelliJ IDEA", &["/usr/bin/idea", "/opt/idea/bin/idea.sh"]),
            ("neovim", "Neovim", &["/usr/bin/nvim", "/usr/local/bin/nvim"]),
            ("xcode", "Xcode", &[]),
        ];

        for (id, name, paths) in checks {
            let found = paths.iter().find(|p| std::path::Path::new(p).exists());
            editors.push(DetectedEditor {
                id: id.to_string(),
                name: name.to_string(),
                path: found.map(|p| p.to_string()).unwrap_or_default(),
                installed: found.is_some(),
            });
        }

        // Try nautilus, dolphin, thunar in order
        let fm_name = if std::path::Path::new("/usr/bin/nautilus").exists() { "Files" }
            else if std::path::Path::new("/usr/bin/dolphin").exists() { "Dolphin" }
            else if std::path::Path::new("/usr/bin/thunar").exists() { "Thunar" }
            else { "File Manager" };

        editors.push(DetectedEditor {
            id: "file_explorer".into(),
            name: fm_name.into(),
            path: String::new(),
            installed: true,
        });
    }

    editors
}

/// Open the project's app folder in a code editor or the system file explorer.
#[tauri::command]
fn open_in_editor(
    app: tauri::AppHandle,
    project_id: String,
    editor_id: String,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    if !app_root.exists() {
        return Err("Project app folder does not exist yet".into());
    }

    let abs = app_root.to_string_lossy().to_string();

    // ── File explorer shortcut ──
    if editor_id == "file_explorer" {
        #[cfg(target_os = "macos")]
        { std::process::Command::new("open").arg(&abs).spawn().map_err(|e| format!("Failed: {e}"))?; }
        #[cfg(target_os = "windows")]
        { std::process::Command::new("explorer").arg(&abs).spawn().map_err(|e| format!("Failed: {e}"))?; }
        #[cfg(target_os = "linux")]
        { std::process::Command::new("xdg-open").arg(&abs).spawn().map_err(|e| format!("Failed: {e}"))?; }
        return Ok(());
    }

    // ── Code editor ──
    let editors = detect_editors();
    let editor = editors.iter().find(|e| e.id == editor_id && e.installed)
        .ok_or_else(|| format!("Editor '{}' not installed", editor_id))?;

    #[cfg(target_os = "macos")]
    {
        if editor.path.ends_with(".app") {
            std::process::Command::new("open")
                .args(["-a", &editor.path, &abs])
                .spawn()
                .map_err(|e| format!("Failed to open: {e}"))?;
        } else {
            std::process::Command::new(&editor.path)
                .arg(&abs)
                .spawn()
                .map_err(|e| format!("Failed to open: {e}"))?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new(&editor.path)
            .arg(&abs)
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }

    Ok(())
}

/// Return system information (OS, directories, etc.) so the AI can generate
/// platform-correct code without guessing.
#[tauri::command]
fn get_system_info() -> SystemInfo {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let desktop = dirs::desktop_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let documents = dirs::document_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let downloads = dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default();

    SystemInfo {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        home_dir: home,
        desktop_dir: desktop,
        documents_dir: documents,
        downloads_dir: downloads,
        username,
    }
}

// ── Build / Ship Commands ──

#[derive(Clone, Serialize)]
struct ShipEvent {
    project_id: String,
    kind: String, // "log" | "done" | "error"
    message: String,
}

/// Read the "name" field from the project's package.json, fallback to "Raincast App".
fn read_app_name(app_root: &Path) -> String {
    // 1. Prefer productName from tauri.conf.json (always written fresh per project)
    let tauri_conf = app_root.join("src-tauri").join("tauri.conf.json");
    if let Ok(content) = fs::read_to_string(&tauri_conf) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(name) = json["productName"].as_str() {
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
    }

    // 2. Fall back to package.json name (title-cased)
    let pkg = app_root.join("package.json");
    if let Ok(content) = fs::read_to_string(&pkg) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(name) = json["name"].as_str() {
                if name != "raincast-app" {
                    return name.split('-')
                        .map(|w| {
                            let mut c = w.chars();
                            match c.next() {
                                None => String::new(),
                                Some(f) => f.to_uppercase().chain(c).collect(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                }
            }
        }
    }

    "Raincast App".to_string()
}

/// Run a command, streaming each stdout/stderr line as a ship-log event.
/// Returns true if the process exited successfully.
fn run_streaming(
    cmd: &str,
    args: &[&str],
    cwd: &Path,
    handle: &tauri::AppHandle,
    project_id: &str,
    ship: &ShipHandle,
) -> Result<bool, String> {
    run_streaming_env(cmd, args, cwd, handle, project_id, &[], ship)
}

fn run_streaming_env(
    cmd: &str,
    args: &[&str],
    cwd: &Path,
    handle: &tauri::AppHandle,
    project_id: &str,
    envs: &[(&str, &str)],
    ship: &ShipHandle,
) -> Result<bool, String> {
    // Check cancellation before spawning
    if ship.cancelled.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }

    let mut command = Command::new(cmd);
    command.args(args).current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in envs {
        command.env(k, v);
    }
    let mut child = command.spawn()
        .map_err(|e| format!("Failed to spawn {cmd}: {e}"))?;

    // Track the PID so cancel_ship can kill it
    let pid = child.id();
    if let Ok(mut guard) = ship.current_pid.lock() {
        *guard = Some(pid);
    }

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let h1 = handle.clone();
    let p1 = project_id.to_string();
    let t1 = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = h1.emit("ship-log", ShipEvent {
                project_id: p1.clone(),
                kind: "log".into(),
                message: line,
            });
        }
    });

    let h2 = handle.clone();
    let p2 = project_id.to_string();
    let t2 = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = h2.emit("ship-log", ShipEvent {
                project_id: p2.clone(),
                kind: "log".into(),
                message: line,
            });
        }
    });

    let status = child.wait().map_err(|e| format!("Wait failed: {e}"))?;
    let _ = t1.join();
    let _ = t2.join();

    // Clear PID
    if let Ok(mut guard) = ship.current_pid.lock() {
        *guard = None;
    }

    // Check cancellation after process completes
    if ship.cancelled.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }

    Ok(status.success())
}

/// Seed a minimal Tauri 2 project inside the generated app so `npx tauri build` works.
fn seed_tauri_config(app_root: &Path, app_name: &str, project_id: &str) -> Result<(), String> {
    let tauri_dir = app_root.join("src-tauri");
    let src_dir = tauri_dir.join("src");
    fs::create_dir_all(&src_dir)
        .map_err(|e| format!("Cannot create src-tauri/src: {e}"))?;

    // Always rewrite tauri.conf.json so product name stays in sync
    // (user may have re-generated with a different app name)
    let tauri_conf = tauri_dir.join("tauri.conf.json");
    let bundle_id = format!("com.raincast.shipped.{}", project_id);
    let conf_content = format!(
        r#"{{
  "productName": "{app_name}",
  "version": "1.0.0",
  "identifier": "{bundle_id}",
  "build": {{
    "frontendDist": "../dist"
  }},
  "app": {{
    "macOSPrivateApi": true,
    "windows": [
      {{
        "title": "",
        "width": 1200,
        "height": 800,
        "center": true,
        "transparent": true,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "trafficLightPosition": {{ "x": 13, "y": 22 }}
      }}
    ]
  }},
  "bundle": {{
    "active": true,
    "targets": ["app"],
    "icon": ["icons/icon.png"]
  }}
}}"#
    );
    atomic_write(&tauri_conf, conf_content.as_bytes())?;

    // Cargo.toml
    let cargo_toml = tauri_dir.join("Cargo.toml");
    if !cargo_toml.exists() {
        let cargo_name = app_name.to_lowercase().replace(' ', "-");
        let content = format!(
            r#"[package]
name = "{cargo_name}"
version = "1.0.0"
edition = "2021"

[build-dependencies]
tauri-build = {{ version = "2", features = [] }}

[dependencies]
tauri = {{ version = "2", features = ["macos-private-api"] }}
serde = {{ version = "1", features = ["derive"] }}
serde_json = "1"
"#
        );
        atomic_write(&cargo_toml, content.as_bytes())?;
    }

    // build.rs
    let build_rs = tauri_dir.join("build.rs");
    if !build_rs.exists() {
        atomic_write(&build_rs, b"fn main() { tauri_build::build() }\n")?;
    }

    // src/main.rs
    let main_rs = src_dir.join("main.rs");
    if !main_rs.exists() {
        let content = r#"#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
"#;
        atomic_write(&main_rs, content.as_bytes())?;
    }

    // tauri.conf.json is always written at the top of seed_tauri_config


    // capabilities/default.json — Tauri 2 requires explicit permissions for window APIs
    let caps_dir = tauri_dir.join("capabilities");
    fs::create_dir_all(&caps_dir)
        .map_err(|e| format!("Cannot create capabilities dir: {e}"))?;
    let caps_file = caps_dir.join("default.json");
    let caps_content = r#"{
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-toggle-maximize"
  ]
}
"#;
    atomic_write(&caps_file, caps_content.as_bytes())?;

    // icons/icon.png — Tauri requires at least one icon for `generate_context!()`
    let icons_dir = tauri_dir.join("icons");
    fs::create_dir_all(&icons_dir)
        .map_err(|e| format!("Cannot create icons dir: {e}"))?;
    let icon_file = icons_dir.join("icon.png");
    if !icon_file.exists() {
        // Minimal 32×32 purple PNG (104 bytes)
        let icon_bytes = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x73, 0x7a, 0x7a, 0xf4, 0x00, 0x00, 0x00,
            0x2f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0xed, 0xce, 0x21, 0x01, 0x00,
            0x00, 0x08, 0x03, 0x30, 0x0a, 0x91, 0x90, 0x82, 0xb4, 0x82, 0x18, 0x37,
            0x13, 0xf3, 0xab, 0xe9, 0xbd, 0xa4, 0x12, 0x10, 0x10, 0x10, 0x10, 0x10,
            0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x48, 0x07, 0x1e,
            0x1b, 0x64, 0xbc, 0x88, 0x89, 0x0c, 0x02, 0xff, 0x00, 0x00, 0x00, 0x00,
            0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        atomic_write(&icon_file, &icon_bytes)?;
    }

    // Patch existing tauri.conf.json if it has an empty icon array
    if tauri_conf.exists() {
        if let Ok(content) = fs::read_to_string(&tauri_conf) {
            if content.contains("\"icon\": []") {
                let patched = content.replace("\"icon\": []", "\"icon\": [\"icons/icon.png\"]");
                let _ = atomic_write(&tauri_conf, patched.as_bytes());
            }
        }
    }

    // capabilities/default.json
    let cap_dir = tauri_dir.join("capabilities");
    fs::create_dir_all(&cap_dir)
        .map_err(|e| format!("Cannot create capabilities dir: {e}"))?;
    let cap_file = cap_dir.join("default.json");
    if !cap_file.exists() {
        let content = r#"{
  "identifier": "default",
  "description": "default capability",
  "windows": ["main"],
  "permissions": ["core:default"]
}
"#;
        atomic_write(&cap_file, content.as_bytes())?;
    }

    // Add @tauri-apps/cli to devDependencies in package.json if not present
    let pkg_path = app_root.join("package.json");
    if let Ok(pkg_str) = fs::read_to_string(&pkg_path) {
        if let Ok(mut pkg) = serde_json::from_str::<serde_json::Value>(&pkg_str) {
            let dev_deps = pkg.get_mut("devDependencies")
                .and_then(|v| v.as_object_mut());
            if let Some(deps) = dev_deps {
                if !deps.contains_key("@tauri-apps/cli") {
                    deps.insert("@tauri-apps/cli".into(), serde_json::json!("^2"));
                    let updated = serde_json::to_string_pretty(&pkg)
                        .map_err(|e| format!("Cannot serialize package.json: {e}"))?;
                    atomic_write(&pkg_path, updated.as_bytes())?;
                }
            }
        }
    }

    Ok(())
}

/// Ship the project: builds a native Tauri .app and installs it.
/// Returns immediately — work happens in a background thread with events.
#[tauri::command]
fn ship_project(
    app: tauri::AppHandle,
    project_id: String,
    app_name: Option<String>,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    if !app_root.exists() {
        return Err("No app to ship. Generate an app first.".into());
    }

    // Create a cancellation handle for this build
    let ship_handle = ShipHandle {
        cancelled: Arc::new(AtomicBool::new(false)),
        current_pid: Arc::new(Mutex::new(None)),
    };

    // Register it so cancel_ship can find it
    {
        let state = app.state::<ShipCancelState>();
        let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
        map.insert(project_id.clone(), ShipHandle {
            cancelled: Arc::clone(&ship_handle.cancelled),
            current_pid: Arc::clone(&ship_handle.current_pid),
        });
    }

    // Spawn background thread so the UI stays responsive
    std::thread::spawn(move || {
        ship_worker(app, project_id, app_root, app_name, ship_handle);
    });

    Ok(())
}

/// Cancel an in-progress ship build. Kills the current subprocess and flags cancellation.
#[tauri::command]
fn cancel_ship(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    let state = app.state::<ShipCancelState>();
    let map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    if let Some(handle) = map.get(&project_id) {
        handle.cancelled.store(true, Ordering::Relaxed);

        // Kill the running child process and its descendants
        if let Ok(guard) = handle.current_pid.lock() {
            if let Some(pid) = *guard {
                let pid_str = pid.to_string();
                // Kill children first, then the process itself
                let _ = Command::new("pkill").args(["-P", &pid_str])
                    .stdout(Stdio::null()).stderr(Stdio::null()).status();
                let _ = Command::new("kill").arg(&pid_str)
                    .stdout(Stdio::null()).stderr(Stdio::null()).status();
            }
        }
    }

    Ok(())
}

fn ship_worker(handle: tauri::AppHandle, project_id: String, app_root: PathBuf, explicit_name: Option<String>, ship: ShipHandle) {
    let pid = project_id.clone();
    let h = handle.clone();

    // Run the actual work; clean up the cancel state when done
    ship_worker_inner(&handle, &project_id, &app_root, explicit_name, &ship);

    // Clean up the cancel state
    {
        let state = h.state::<ShipCancelState>();
        let mut map = state.0.lock().unwrap();
        map.remove(&pid);
    }
}

fn ship_worker_inner(handle: &tauri::AppHandle, project_id: &str, app_root: &Path, explicit_name: Option<String>, ship: &ShipHandle) {
    let emit = |kind: &str, msg: &str| {
        let _ = handle.emit("ship-log", ShipEvent {
            project_id: project_id.to_string(),
            kind: kind.into(),
            message: msg.into(),
        });
    };

    // Helper: check if cancelled before each step
    let check_cancel = || -> bool {
        ship.cancelled.load(Ordering::Relaxed)
    };

    // Use the explicit name from the UI if provided, otherwise read from project files
    let app_name = explicit_name
        .filter(|n| !n.is_empty() && !n.starts_with("App #"))
        .unwrap_or_else(|| read_app_name(app_root));

    // Step 1: Seed Tauri config
    emit("log", "── Preparing native app project...");
    if let Err(e) = seed_tauri_config(app_root, &app_name, project_id) {
        emit("error", &format!("Failed to seed Tauri config: {e}"));
        return;
    }
    emit("log", "  Tauri config ready");

    if check_cancel() { emit("error", "Ship cancelled."); return; }

    // Step 2: npm install (includes @tauri-apps/cli)
    emit("log", "");
    emit("log", "── Installing dependencies...");
    match run_streaming("npm", &["install"], app_root, handle, project_id, ship) {
        Ok(true) => emit("log", "  Dependencies installed"),
        Ok(false) if check_cancel() => { emit("error", "Ship cancelled."); return; }
        Ok(false) => { emit("error", "npm install failed. Check logs above."); return; }
        Err(e) if e == "Cancelled" => { emit("error", "Ship cancelled."); return; }
        Err(e) => { emit("error", &format!("npm install error: {e}")); return; }
    }

    if check_cancel() { emit("error", "Ship cancelled."); return; }

    // Step 3: Build frontend assets (vite build → dist/)
    emit("log", "");
    emit("log", "── Building frontend assets...");
    match run_streaming("npx", &["vite", "build"], app_root, handle, project_id, ship) {
        Ok(true) => emit("log", "  Frontend build complete"),
        Ok(false) if check_cancel() => { emit("error", "Ship cancelled."); return; }
        Ok(false) => { emit("error", "Frontend build failed (vite build). Check logs above."); return; }
        Err(e) if e == "Cancelled" => { emit("error", "Ship cancelled."); return; }
        Err(e) => { emit("error", &format!("Frontend build error: {e}")); return; }
    }

    if check_cancel() { emit("error", "Ship cancelled."); return; }

    // Step 4: Build native app with Tauri CLI
    // --no-sign skips all code signing and notarization so no Apple account is needed.
    emit("log", "");
    emit("log", "── Building native app (this may take a few minutes on first build)...");
    match run_streaming_env(
        "npx", &["tauri", "build", "--no-sign"],
        app_root, handle, project_id,
        &[], ship,
    ) {
        Ok(true) => {}
        Ok(false) if check_cancel() => { emit("error", "Ship cancelled."); return; }
        Ok(false) => { emit("error", "Tauri build failed. Check logs above."); return; }
        Err(e) if e == "Cancelled" => { emit("error", "Ship cancelled."); return; }
        Err(e) => { emit("error", &format!("Tauri build error: {e}")); return; }
    }

    // Step 5: Find the .app bundle in the build output
    let bundle_dir = app_root.join("src-tauri/target/release/bundle/macos");
    // Use app_name directly to avoid picking up stale bundles from previous builds
    let expected = bundle_dir.join(format!("{}.app", app_name));
    let app_bundle = if expected.exists() {
        expected
    } else {
        // Fallback: scan for any .app
        match fs::read_dir(&bundle_dir) {
            Ok(entries) => {
                match entries.filter_map(|e| e.ok())
                    .find(|e| e.file_name().to_string_lossy().ends_with(".app"))
                    .map(|e| e.path())
                {
                    Some(p) => p,
                    None => {
                        emit("error", "Build completed but .app bundle not found in target/release/bundle/macos/");
                        return;
                    }
                }
            }
            Err(_) => {
                emit("error", "Build completed but .app bundle not found in target/release/bundle/macos/");
                return;
            }
        }
    };

    // Step 6: Copy to ~/Applications
    emit("log", "");
    emit("log", "── Installing to ~/Applications...");
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => {
            emit("error", "Cannot determine HOME directory");
            return;
        }
    };
    let install_dir = PathBuf::from(&home).join("Applications");
    if let Err(e) = fs::create_dir_all(&install_dir) {
        emit("error", &format!("Cannot create ~/Applications: {e}"));
        return;
    }

    let installed_path = install_dir.join(app_bundle.file_name().unwrap());
    // Remove old installation
    if installed_path.exists() {
        let _ = fs::remove_dir_all(&installed_path);
    }

    // Copy the .app bundle
    if let Err(e) = copy_dir_recursive(&app_bundle, &installed_path) {
        emit("error", &format!("Failed to install app: {e}"));
        return;
    }

    emit("log", &format!("  Installed: {}", installed_path.display()));
    emit("log", "");
    emit("log", &format!("── {} is ready!", app_name));

    // Signal completion with the installed path
    emit("done", &installed_path.to_string_lossy());
}

/// Recursively copy a directory tree.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("Cannot create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src)
        .map_err(|e| format!("Cannot read {}: {e}", src.display()))?
    {
        let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
        let ty = entry.file_type().map_err(|e| format!("Type error: {e}"))?;
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest)
                .map_err(|e| format!("Cannot copy {}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

/// Launch the shipped .app from ~/Applications.
#[tauri::command]
fn launch_shipped_app(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    let app_root = project_root(&app, &project_id)?.join("app");
    let app_name = read_app_name(&app_root);
    let home = std::env::var("HOME").map_err(|_| "Cannot find HOME".to_string())?;
    let installed = PathBuf::from(&home)
        .join("Applications")
        .join(format!("{}.app", app_name));

    if !installed.exists() {
        return Err("App not installed yet. Click Ship first.".into());
    }

    Command::new("open")
        .arg(&installed)
        .spawn()
        .map_err(|e| format!("Failed to launch app: {e}"))?;

    Ok(())
}

// ── Preview Server Commands ──

#[derive(Serialize)]
struct StartPreviewResult {
    port: u16,
}

#[derive(Serialize)]
struct PreviewLogs {
    stdout_tail: Vec<String>,
    stderr_tail: Vec<String>,
}

/// Find a free TCP port by binding to port 0 and reading the assigned port.
fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Cannot find free port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Cannot read port: {e}"))?
        .port();
    // Drop the listener to free the port before Vite binds to it
    drop(listener);
    Ok(port)
}

#[tauri::command]
fn start_preview_server(
    app: tauri::AppHandle,
    project_id: String,
    port: Option<u16>,
) -> Result<StartPreviewResult, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    if !app_root.exists() {
        return Err("App root does not exist. Run init_project first.".into());
    }

    // Ensure node_modules exist (may be missing after workspace restore)
    if !app_root.join("node_modules").exists() {
        let install = Command::new("npm")
            .args(["install"])
            .current_dir(&app_root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if let Err(e) = install {
            return Err(format!("npm install failed: {e}"));
        }
    }

    // Use provided port or find a free one dynamically
    let port = match port {
        Some(p) => p,
        None => find_free_port()?,
    };

    // Stop existing server for this project if any
    let state = app.state::<PreviewState>();
    {
        let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
        if let Some(mut proc) = map.remove(&project_id) {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
        }
    }

    // Spawn: npx vite --host 127.0.0.1 --port <port> --strictPort
    // --strictPort ensures Vite uses exactly this port (no auto-increment)
    let mut child = Command::new("npx")
        .args(["vite", "--host", "127.0.0.1", "--port", &port.to_string(), "--strictPort"])
        .current_dir(&app_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn preview server: {e}"))?;

    let stdout_buf: LogBuffer = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf: LogBuffer = Arc::new(Mutex::new(Vec::new()));

    // Take the pipes and spawn reader threads
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, Arc::clone(&stdout_buf));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, Arc::clone(&stderr_buf));
    }

    let proc = PreviewProcess {
        child,
        stdout_buf,
        stderr_buf,
    };

    {
        let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
        map.insert(project_id, proc);
    }

    Ok(StartPreviewResult { port })
}

#[tauri::command]
fn stop_preview_server(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    let state = app.state::<PreviewState>();
    let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    if let Some(mut proc) = map.remove(&project_id) {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
        Ok(())
    } else {
        Ok(()) // Not running is not an error
    }
}

#[tauri::command]
fn get_preview_logs(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<PreviewLogs, String> {
    let state = app.state::<PreviewState>();
    let map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;

    if let Some(proc) = map.get(&project_id) {
        let stdout_tail = proc.stdout_buf.lock()
            .map(|v| v.clone())
            .unwrap_or_default();
        let stderr_tail = proc.stderr_buf.lock()
            .map(|v| v.clone())
            .unwrap_or_default();

        Ok(PreviewLogs { stdout_tail, stderr_tail })
    } else {
        Ok(PreviewLogs {
            stdout_tail: vec![],
            stderr_tail: vec![],
        })
    }
}

// ── Blue-Engine Commands ──

#[derive(Serialize)]
struct BlueEngineInfo {
    port: u16,
    invoke_key: String,
    commands: Vec<String>,
}

#[tauri::command]
fn start_blue_engine(
    app: tauri::AppHandle,
    project_id: String,
    port: Option<u16>,
) -> Result<BlueEngineInfo, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    // Stop existing engine for this project
    {
        let state = app.state::<BlueEngineState>();
        let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
        if let Some(mut proc) = map.remove(&project_id) {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
        }
    }

    // Check if commands.rs exists (system tier app)
    let commands_rs = app_root.join("src-tauri").join("src").join("commands.rs");
    if !commands_rs.exists() {
        return Err("No commands.rs found — this app has no backend commands".into());
    }

    let engine_port = match port {
        Some(p) => p,
        None => find_free_port()?,
    };

    // Resolve the blue-engine CLI script
    // It's installed in the monorepo: packages/blue-engine/dist/cli.js
    // At runtime, we find it relative to the resource dir or use npx
    let resource_dir = app.path().resource_dir().map_err(|e| format!("{e}"))?;
    let engine_script = resource_dir.join("packages").join("blue-engine").join("dist").join("cli.js");

    // Fallback: try from the workspace root
    let script_path = if engine_script.exists() {
        engine_script
    } else {
        // Dev mode: relative to the tauri src dir
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or(Path::new("."))
            .join("packages")
            .join("blue-engine")
            .join("dist")
            .join("cli.js");
        if dev_path.exists() {
            dev_path
        } else {
            return Err("blue-engine CLI not found. Run `npm run build` in packages/blue-engine.".into());
        }
    };

    let mut child = Command::new("node")
        .args([
            script_path.to_string_lossy().as_ref(),
            "--project",
            app_root.to_string_lossy().as_ref(),
            "--port",
            &engine_port.to_string(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn blue-engine: {e}"))?;

    // Stream stderr as Tauri events so the frontend can display blue-engine logs
    let log_thread = if let Some(stderr) = child.stderr.take() {
        let app_handle = app.clone();
        let pid = project_id.clone();
        Some(std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app_handle.emit("blue-engine-log", serde_json::json!({
                            "project_id": pid,
                            "message": l,
                        }));
                    }
                    Err(_) => break,
                }
            }
        }))
    } else {
        None
    };

    // Read the first line of stdout for the ready JSON
    let stdout = child.stdout.take().ok_or("No stdout from blue-engine")?;
    let reader = BufReader::new(stdout);
    let mut first_line = String::new();

    // Read with a timeout (5s)
    use std::io::Read;
    let mut stdout_ref = reader.into_inner();
    let mut buf = [0u8; 4096];
    let start = std::time::Instant::now();
    let mut accumulated = String::new();

    loop {
        if start.elapsed().as_secs() > 10 {
            let _ = child.kill();
            return Err("blue-engine startup timed out".into());
        }

        // Non-blocking read approach: try to read, sleep briefly if nothing
        // Since we need the first line, read byte by byte or in chunks
        match stdout_ref.read(&mut buf) {
            Ok(0) => {
                let _ = child.kill();
                return Err("blue-engine exited before ready".into());
            }
            Ok(n) => {
                accumulated.push_str(&String::from_utf8_lossy(&buf[..n]));
                if let Some(pos) = accumulated.find('\n') {
                    first_line = accumulated[..pos].to_string();
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Failed to read blue-engine output: {e}"));
            }
        }
    }

    // Parse the ready JSON: { "ready": true, "port": N, "invokeKey": "...", "commands": [...] }
    let info: serde_json::Value = serde_json::from_str(&first_line)
        .map_err(|e| format!("Invalid blue-engine output: {e}\nGot: {first_line}"))?;

    let actual_port = info["port"].as_u64().unwrap_or(engine_port as u64) as u16;
    let invoke_key = info["invokeKey"].as_str().unwrap_or("").to_string();
    let commands: Vec<String> = info["commands"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if invoke_key.is_empty() {
        let _ = child.kill();
        return Err("blue-engine did not return an invoke key".into());
    }

    // Store the process
    let state = app.state::<BlueEngineState>();
    let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    map.insert(project_id, BlueEngineProcess {
        child,
        port: actual_port,
        invoke_key: invoke_key.clone(),
        _log_thread: log_thread,
    });

    Ok(BlueEngineInfo {
        port: actual_port,
        invoke_key,
        commands,
    })
}

#[tauri::command]
fn stop_blue_engine(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    let state = app.state::<BlueEngineState>();
    let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(mut proc) = map.remove(&project_id) {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
    Ok(())
}

// ── Database Commands ──

#[tauri::command]
fn db_load_all(state: tauri::State<'_, db::DbState>) -> Result<db::LoadResult, String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    db::load_all(&conn)
}

#[tauri::command]
fn db_create_project(state: tauri::State<'_, db::DbState>, title: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    let id = Uuid::new_v4().to_string();
    db::create_project(&conn, &id, &title)?;
    Ok(id)
}

#[tauri::command]
fn db_rename_project(state: tauri::State<'_, db::DbState>, id: String, title: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    db::rename_project(&conn, &id, &title)
}

#[tauri::command]
fn db_set_project_open(state: tauri::State<'_, db::DbState>, id: String, is_open: bool) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    db::set_project_open(&conn, &id, is_open)
}

#[tauri::command]
fn db_delete_project(state: tauri::State<'_, db::DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    db::delete_project(&conn, &id)
}

#[tauri::command]
fn db_save_messages(state: tauri::State<'_, db::DbState>, project_id: String, messages: Vec<db::DbMessage>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    db::save_messages(&conn, &project_id, &messages)
}

#[tauri::command]
fn db_set_setting(state: tauri::State<'_, db::DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("DB lock: {e}"))?;
    db::set_setting(&conn, &key, &value)
}

/// Check if a project has a generated app workspace on disk.
#[tauri::command]
fn check_project_has_app(app: tauri::AppHandle, project_id: String) -> Result<bool, String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");
    // Consider a project "has app" if app/src exists (not just the seeded package.json)
    Ok(app_root.join("src").exists())
}

/// Save generation logs to disk so they survive app restarts.
#[tauri::command]
fn save_generation_logs(
    app: tauri::AppHandle,
    project_id: String,
    logs: Vec<String>,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let rain_dir = root.join(".rain");
    fs::create_dir_all(&rain_dir).map_err(|e| format!("Cannot create .rain dir: {e}"))?;
    let log_path = rain_dir.join("generation.log");
    let content = logs.join("\n");
    fs::write(&log_path, content).map_err(|e| format!("Cannot write logs: {e}"))?;
    Ok(())
}

/// Load generation logs from disk.
#[tauri::command]
fn load_generation_logs(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<String>, String> {
    let root = project_root(&app, &project_id)?;
    let log_path = root.join(".rain").join("generation.log");
    if !log_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Cannot read logs: {e}"))?;
    Ok(content.lines().map(|s| s.to_string()).collect())
}

/// Save ship logs to disk so they survive app restarts.
#[tauri::command]
fn save_ship_logs(
    app: tauri::AppHandle,
    project_id: String,
    logs: Vec<String>,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let rain_dir = root.join(".rain");
    fs::create_dir_all(&rain_dir).map_err(|e| format!("Cannot create .rain dir: {e}"))?;
    let log_path = rain_dir.join("ship.log");
    let content = logs.join("\n");
    fs::write(&log_path, content).map_err(|e| format!("Cannot write ship logs: {e}"))?;
    Ok(())
}

/// Load ship logs from disk.
#[tauri::command]
fn load_ship_logs(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<String>, String> {
    let root = project_root(&app, &project_id)?;
    let log_path = root.join(".rain").join("ship.log");
    if !log_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Cannot read ship logs: {e}"))?;
    Ok(content.lines().map(|s| s.to_string()).collect())
}

/// Save an app icon (PNG bytes as base64) for the project.
/// Writes to both the .rain/ metadata dir and the src-tauri/icons/ dir for shipping.
#[tauri::command]
fn save_app_icon(
    app: tauri::AppHandle,
    project_id: String,
    png_base64: String,
) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let png_bytes = STANDARD.decode(&png_base64)
        .map_err(|e| format!("Invalid base64: {e}"))?;

    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    // Save to .rain/ for persistence
    let rain_dir = root.join(".rain");
    fs::create_dir_all(&rain_dir).map_err(|e| format!("Cannot create .rain dir: {e}"))?;
    fs::write(rain_dir.join("icon.png"), &png_bytes)
        .map_err(|e| format!("Cannot write icon to .rain: {e}"))?;

    // Save to src-tauri/icons/ for shipping (overwrite the placeholder)
    let icons_dir = app_root.join("src-tauri").join("icons");
    fs::create_dir_all(&icons_dir).map_err(|e| format!("Cannot create icons dir: {e}"))?;
    fs::write(icons_dir.join("icon.png"), &png_bytes)
        .map_err(|e| format!("Cannot write icon to icons dir: {e}"))?;

    Ok(())
}

/// Load the saved app icon as a PNG data URL. Returns empty string if no icon exists.
#[tauri::command]
fn load_app_icon(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let root = project_root(&app, &project_id)?;
    let icon_path = root.join(".rain").join("icon.png");

    if !icon_path.exists() {
        return Ok(String::new());
    }

    let bytes = fs::read(&icon_path)
        .map_err(|e| format!("Cannot read icon: {e}"))?;
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Update the app name across all generated source files.
/// Reads the old name from tauri.conf.json, then replaces it everywhere:
/// config files, index.html, and all .tsx/.ts source files.
#[tauri::command]
fn rename_app_in_source(
    app: tauri::AppHandle,
    project_id: String,
    new_name: String,
) -> Result<(), String> {
    let root = project_root(&app, &project_id)?;
    let app_root = root.join("app");

    if !app_root.exists() {
        return Ok(()); // no generated app yet, nothing to update
    }

    // Update index.html <title> tag
    let index_html = app_root.join("index.html");
    if index_html.exists() {
        let raw = fs::read_to_string(&index_html)
            .map_err(|e| format!("Cannot read index.html: {e}"))?;
        if let (Some(start), Some(end)) = (raw.find("<title>"), raw.find("</title>")) {
            let mut updated = String::new();
            updated.push_str(&raw[..start]);
            updated.push_str(&format!("<title>{}</title>", new_name));
            updated.push_str(&raw[end + "</title>".len()..]);
            if updated != raw {
                atomic_write(&index_html, updated.as_bytes())?;
            }
        }
    }

    Ok(())
}

/// Kill orphaned Vite dev server processes from previous sessions.
fn kill_orphaned_vite_processes() {
    // Use pkill to kill any leftover `vite` processes spawned by us.
    // This is best-effort — if it fails, we just skip cleanup.
    let _ = Command::new("pkill")
        .args(["-f", "node.*vite.*--host 127.0.0.1"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(PreviewState(Mutex::new(HashMap::new())))
        .manage(BlueEngineState(Mutex::new(HashMap::new())))
        .manage(ShipCancelState(Mutex::new(HashMap::new())))
        .setup(|app| {
            // Kill any orphaned Vite processes from previous sessions
            kill_orphaned_vite_processes();

            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let db_path = data_dir.join("raincast.db");
            let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;
            app.manage(db::DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_project,
            stage_files,
            apply_checkpoint,
            rollback_snapshot,
            reapply_snapshot,
            run_validation,
            start_preview_server,
            stop_preview_server,
            get_preview_logs,
            start_blue_engine,
            stop_blue_engine,
            bridge_read_file,
            bridge_write_file,
            bridge_delete_file,
            bridge_list_dir,
            bridge_grep_files,
            bridge_clipboard_read,
            bridge_clipboard_write,
            bridge_app_info,
            get_system_info,
            detect_editors,
            open_in_editor,
            ship_project,
            launch_shipped_app,
            db_load_all,
            db_create_project,
            db_rename_project,
            db_set_project_open,
            db_delete_project,
            db_save_messages,
            db_set_setting,
            check_project_has_app,
            save_generation_logs,
            load_generation_logs,
            save_ship_logs,
            load_ship_logs,
            save_app_icon,
            load_app_icon,
            rename_app_in_source,
            cancel_ship,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
