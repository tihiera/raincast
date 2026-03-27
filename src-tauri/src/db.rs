use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

// ── Managed state ────────────────────────────────────────────────────

pub struct DbState(pub Mutex<Connection>);

// ── Schema ───────────────────────────────────────────────────────────

const MIGRATIONS: &[&str] = &[
    // Migration 1: initial schema
    "CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT 'Untitled',
        created_at  INTEGER NOT NULL,
        is_open     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS messages (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        status_data TEXT,
        ordering    INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, ordering);

    CREATE TABLE IF NOT EXISTS images (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        mime        TEXT NOT NULL,
        base64      TEXT NOT NULL,
        canvas_data TEXT,
        ordering    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_images_message ON images(message_id);

    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
];

pub fn init_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path)
        .map_err(|e| format!("Cannot open database: {e}"))?;

    // Enable WAL mode + foreign keys
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Cannot set PRAGMAs: {e}"))?;

    // Schema version tracking
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0);",
    )
    .map_err(|e| format!("Cannot create schema_version: {e}"))?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (i, migration) in MIGRATIONS.iter().enumerate() {
        let ver = (i + 1) as i64;
        if ver > current_version {
            conn.execute_batch(migration)
                .map_err(|e| format!("Migration {ver} failed: {e}"))?;
            if current_version == 0 && ver == 1 {
                conn.execute("INSERT INTO schema_version (version) VALUES (?1)", params![ver])
                    .map_err(|e| format!("Cannot insert schema version: {e}"))?;
            } else {
                conn.execute("UPDATE schema_version SET version = ?1", params![ver])
                    .map_err(|e| format!("Cannot update schema version: {e}"))?;
            }
        }
    }

    Ok(conn)
}

// ── Types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DbProject {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub is_open: bool,
    pub messages: Vec<DbMessage>,
}

#[derive(Serialize, Deserialize)]
pub struct DbMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub status_data: Option<String>,
    pub images: Vec<DbImage>,
}

#[derive(Serialize, Deserialize)]
pub struct DbImage {
    pub mime: String,
    pub base64: String,
    pub canvas_data: Option<String>,
}

#[derive(Serialize)]
pub struct LoadResult {
    pub projects: Vec<DbProject>,
    pub active_project_id: Option<String>,
    pub active_provider: Option<String>,
}

// ── CRUD functions ───────────────────────────────────────────────────

pub fn load_all(conn: &Connection) -> Result<LoadResult, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, created_at, is_open FROM projects ORDER BY created_at ASC")
        .map_err(|e| format!("load_all projects: {e}"))?;

    let projects: Vec<DbProject> = stmt
        .query_map([], |row| {
            Ok(DbProject {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                is_open: row.get::<_, i64>(3)? != 0,
                messages: Vec::new(), // filled below
            })
        })
        .map_err(|e| format!("load_all query: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::with_capacity(projects.len());
    for mut project in projects {
        project.messages = load_messages(conn, &project.id)?;
        result.push(project);
    }

    let active_project_id = get_setting(conn, "active_project_id");
    let active_provider = get_setting(conn, "active_provider");

    Ok(LoadResult {
        projects: result,
        active_project_id,
        active_provider,
    })
}

fn load_messages(conn: &Connection, project_id: &str) -> Result<Vec<DbMessage>, String> {
    let mut msg_stmt = conn
        .prepare(
            "SELECT id, role, content, status_data FROM messages
             WHERE project_id = ?1 ORDER BY ordering ASC",
        )
        .map_err(|e| format!("load_messages: {e}"))?;

    let mut img_stmt = conn
        .prepare(
            "SELECT mime, base64, canvas_data FROM images
             WHERE message_id = ?1 ORDER BY ordering ASC",
        )
        .map_err(|e| format!("load_messages images: {e}"))?;

    let messages: Vec<DbMessage> = msg_stmt
        .query_map(params![project_id], |row| {
            Ok(DbMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                status_data: row.get(3)?,
                images: Vec::new(),
            })
        })
        .map_err(|e| format!("load_messages query: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::with_capacity(messages.len());
    for mut msg in messages {
        let images: Vec<DbImage> = img_stmt
            .query_map(params![msg.id], |row| {
                Ok(DbImage {
                    mime: row.get(0)?,
                    base64: row.get(1)?,
                    canvas_data: row.get(2)?,
                })
            })
            .map_err(|e| format!("load images: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        msg.images = images;
        result.push(msg);
    }

    Ok(result)
}

pub fn create_project(conn: &Connection, id: &str, title: &str) -> Result<(), String> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO projects (id, title, created_at, is_open) VALUES (?1, ?2, ?3, 1)",
        params![id, title, now],
    )
    .map_err(|e| format!("create_project: {e}"))?;
    Ok(())
}

pub fn rename_project(conn: &Connection, id: &str, title: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET title = ?1 WHERE id = ?2",
        params![title, id],
    )
    .map_err(|e| format!("rename_project: {e}"))?;
    Ok(())
}

pub fn set_project_open(conn: &Connection, id: &str, is_open: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET is_open = ?1 WHERE id = ?2",
        params![is_open as i64, id],
    )
    .map_err(|e| format!("set_project_open: {e}"))?;
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("delete_project: {e}"))?;
    Ok(())
}

pub fn save_messages(conn: &Connection, project_id: &str, messages: &[DbMessage]) -> Result<(), String> {
    // Delete existing messages for this project, then re-insert
    conn.execute("DELETE FROM messages WHERE project_id = ?1", params![project_id])
        .map_err(|e| format!("save_messages delete: {e}"))?;

    let now = now_millis();
    for (i, msg) in messages.iter().enumerate() {
        conn.execute(
            "INSERT INTO messages (id, project_id, role, content, status_data, ordering, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![msg.id, project_id, msg.role, msg.content, msg.status_data, i as i64, now],
        )
        .map_err(|e| format!("save_messages insert: {e}"))?;

        for (j, img) in msg.images.iter().enumerate() {
            conn.execute(
                "INSERT INTO images (message_id, mime, base64, canvas_data, ordering)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![msg.id, img.mime, img.base64, img.canvas_data, j as i64],
            )
            .map_err(|e| format!("save_messages image: {e}"))?;
        }
    }

    Ok(())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("set_setting: {e}"))?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
