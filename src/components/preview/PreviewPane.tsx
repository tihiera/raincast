import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Square, Undo2, Redo2, Copy, Check, ChevronUp, ChevronDown, Terminal, Zap } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { List as VirtualList, useListRef } from "react-window";
import PreviewHeader, { type ShipState } from "./PreviewHeader";
import GenerationOverlay from "./GenerationOverlay";
import EmptyIllustration from "./EmptyIllustration";
import SketchCanvas from "../sketch/SketchCanvas";
import { useGenerationContext } from "../../lib/generation/GenerationContext";
import { useProjectContext } from "../../lib/project/ProjectContext";
import { usePreviewContext } from "../../lib/preview/PreviewContext";
import { useSketchContext } from "../../lib/sketch/SketchContext";
import { getPreviewLogs, shipProject, launchShippedApp, saveShipLogs, loadShipLogs, cancelShip, stopBlueEngine, detectEditors, openInEditor, type DetectedEditor } from "../../lib/tauri/workspace";
import { EditorIcon } from "./EditorIcons";
import { attemptShipFix } from "../../lib/generation/shipHeal";
import { getProviderById } from "../../lib/ai";
import { getActiveProviderId } from "../../lib/ai/settings";
import { useShikiHighlight } from "./useShikiHighlight";
import { useAppearance } from "../../ThemeContext";
import shipFinishSound from "../../assets/ship-finish.mp3";

function playShipDing() {
  try {
    const audio = new Audio(shipFinishSound);
    audio.play();
  } catch {
    // Audio not available — silently skip
  }
}

// ── Collapsible log blocks ──

const COLLAPSE_THRESHOLD = 10;

interface CollapseMarker { id: string; hidden: number }

function useCollapsibleLogs(rawLogs: string[]) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const logsEmpty = rawLogs.length === 0;
  useEffect(() => { if (logsEmpty) setExpanded(new Set()); }, [logsEmpty]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const { processed, markers } = useMemo(() => {
    const out: string[] = [];
    const markers = new Map<number, CollapseMarker>();
    let i = 0;

    while (i < rawLogs.length) {
      const line = rawLogs[i];

      if (!line.startsWith("  ┌──")) { out.push(line); i++; continue; }

      const isPatch = /\(\d+ patch/.test(line);
      out.push(line); // block header
      i++;

      if (!isPatch) {
        // ── File content block ──
        const blockId = `f${i}`;
        const isExp = expanded.has(blockId);
        let count = 0;

        while (i < rawLogs.length && !rawLogs[i].startsWith("  └──")) {
          count++;
          if (isExp || count <= COLLAPSE_THRESHOLD) out.push(rawLogs[i]);
          i++;
        }

        if (!isExp && count > COLLAPSE_THRESHOLD) {
          markers.set(out.length, { id: blockId, hidden: count - COLLAPSE_THRESHOLD });
          out.push(""); // placeholder
        }
      } else {
        // ── Patch block (SEARCH / REPLACE sections) ──
        while (i < rawLogs.length && !rawLogs[i].startsWith("  └──")) {
          const isSearchH = /│\s+SEARCH\s+\(/.test(rawLogs[i]);
          const isReplaceH = /│\s+REPLACE\s+\(/.test(rawLogs[i]);

          if (isSearchH || isReplaceH) {
            const prefix = isSearchH ? "  │  - " : "  │  + ";
            const blockId = `${isSearchH ? "s" : "r"}${i}`;
            out.push(rawLogs[i]); // section header
            i++;

            const isExp = expanded.has(blockId);
            let count = 0;

            while (i < rawLogs.length && rawLogs[i].startsWith(prefix)) {
              count++;
              if (isExp || count <= COLLAPSE_THRESHOLD) out.push(rawLogs[i]);
              i++;
            }

            if (!isExp && count > COLLAPSE_THRESHOLD) {
              markers.set(out.length, { id: blockId, hidden: count - COLLAPSE_THRESHOLD });
              out.push(""); // placeholder
            }
          } else {
            out.push(rawLogs[i]);
            i++;
          }
        }
      }

      // Footer
      if (i < rawLogs.length) { out.push(rawLogs[i]); i++; }
    }

    return { processed: out, markers };
  }, [rawLogs, expanded]);

  return { processed, markers, toggle };
}

// ── Log row ──

interface LogRowProps {
  logs: string[];
  highlightMap: Map<number, string>;
  markers: Map<number, CollapseMarker>;
  onToggle: (id: string) => void;
}

function LogRow({ index, style, logs, highlightMap, markers, onToggle }: { index: number; style: React.CSSProperties } & LogRowProps) {
  // ── Collapse marker ──
  const marker = markers.get(index);
  if (marker) {
    return (
      <div
        style={{
          ...style,
          whiteSpace: "pre",
          padding: "0 18px",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 11.5,
          lineHeight: "22px",
          cursor: "pointer",
          color: "var(--slider-thumb)",
          opacity: 0.65,
          transition: "opacity 0.2s, color 0.2s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.65"; }}
        onClick={() => onToggle(marker.id)}
      >
        {"  ··· "}show more ({marker.hidden} more lines)
      </div>
    );
  }

  const line = logs[index] ?? "";
  const isError = line.includes("ERROR") || line.includes("FAILED");
  const isSuccess = line.includes("PASSED") || line.includes("✓");
  const isFileContent = line.startsWith("  │ ") && /^\s+│\s+\d+\s+│/.test(line);
  const isFileBorder = line.startsWith("  ┌──") || line.startsWith("  └──");
  const isTree = line.startsWith("  ├─") || line.startsWith("  │  └─");
  const isSection = line.startsWith("── ");
  const isSterr = line.startsWith("  stderr:") || line.startsWith("  stdout:");

  const highlighted = highlightMap.get(index);

  // For highlighted file content, render the line number prefix + highlighted code
  if (isFileContent && highlighted) {
    const prefixMatch = line.match(/^(\s+│\s+\d+\s+│\s?)/);
    const prefix = prefixMatch ? prefixMatch[1] : "";
    return (
      <div style={{
        ...style,
        whiteSpace: "pre",
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "0 18px",
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 11.5,
        lineHeight: "22px",
      }}>
        <span style={{ color: "var(--text-tertiary)", opacity: 0.6 }}>{prefix}</span>
        <span dangerouslySetInnerHTML={{ __html: highlighted }} />
      </div>
    );
  }

  return (
    <div style={{
      ...style,
      whiteSpace: "pre",
      overflow: "hidden",
      textOverflow: "ellipsis",
      padding: "0 18px",
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: isFileContent ? 11.5 : 12.5,
      lineHeight: "22px",
      color: isError ? "#d44"
        : isSuccess ? "#2a8"
        : isFileBorder ? "var(--slider-thumb)"
        : isFileContent ? "var(--text-tertiary)"
        : isTree ? "var(--text-tertiary)"
        : isSection ? "var(--text-primary)"
        : isSterr ? "#c77"
        : "var(--text-secondary)",
      opacity: isFileContent ? 0.85 : 1,
    }}>
      {line}
    </div>
  );
}

export default function PreviewPane() {
  const { status, undoStack, redoStack, isRunning, cancel, undoLast, redoNext, generationLogs, activeProjectId, runtimeErrorsRef: genRuntimeErrorsRef } = useGenerationContext();
  const { previewUrl, serverError, stopPreview, allPreviewUrls, blueEngine } = usePreviewContext();
  const { isOpen: sketchOpen, initialData: sketchData, closeSketch, insertImage: sketchInsert } = useSketchContext();
  const { active: activeProject } = useProjectContext();
  const projectId = activeProjectId;
  const hasStarted = status.phase !== "idle";
  const [activeTab, setActiveTab] = useState<"ui" | "code">("ui");
  const [serverLogs, setServerLogs] = useState<string[]>([]);

  // ── Detect installed code editors (cached, runs once) ──
  const [allEditors, setAllEditors] = useState<DetectedEditor[]>([]);
  const [activeEditor, setActiveEditor] = useState<DetectedEditor | null>(null);
  const [editorPickerOpen, setEditorPickerOpen] = useState(false);
  const editorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    detectEditors().then((eds) => {
      setAllEditors(eds);
      // Default to first installed editor, or file_explorer fallback
      const installed = eds.filter((e) => e.installed);
      const firstInstalled = installed.find((e) => e.id !== "file_explorer") ?? installed[0] ?? null;
      setActiveEditor(firstInstalled);
    }).catch(() => {});
  }, []);

  // Close picker on outside click
  useEffect(() => {
    if (!editorPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (editorPickerRef.current && !editorPickerRef.current.contains(e.target as Node)) {
        setEditorPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editorPickerOpen]);

  const handleOpenInEditor = useCallback(() => {
    if (!activeEditor) return;
    openInEditor(projectId, activeEditor.id).catch((e) =>
      console.error("[open_in_editor]", e),
    );
  }, [activeEditor, projectId]);

  // ── Morphism reveal: hide iframe until loaded + 1.5s grace period ──
  const [revealedProjects, setRevealedProjects] = useState<Set<string>>(new Set());
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRevealed = revealedProjects.has(projectId);

  // Reset reveal state when preview URL changes (new generation or project switch)
  const prevPreviewUrl = useRef<string | null>(null);
  useEffect(() => {
    if (previewUrl !== prevPreviewUrl.current) {
      prevPreviewUrl.current = previewUrl;
      if (previewUrl) {
        // New preview URL — hide until iframe loads
        setRevealedProjects((s) => { const n = new Set(s); n.delete(projectId); return n; });
      }
    }
  }, [previewUrl, projectId]);

  // Clean up timer on unmount
  useEffect(() => () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); }, []);

  const sendBlueEngineConfig = useCallback((pid: string) => {
    if (!blueEngine) return;
    const iframe = iframeRefs.current[pid];
    try {
      iframe?.contentWindow?.postMessage(
        { type: "blue-engine-config", port: blueEngine.port, invokeKey: blueEngine.invoke_key },
        "*",
      );
    } catch { /* cross-origin */ }
  }, [blueEngine]);

  const handleIframeLoad = useCallback((pid: string) => {
    // Inject blue-engine config into the iframe so bridge.ts can connect
    // Send immediately + repeat a few times to cover components that mount and invoke() early
    sendBlueEngineConfig(pid);
    const t1 = setTimeout(() => sendBlueEngineConfig(pid), 300);
    const t2 = setTimeout(() => sendBlueEngineConfig(pid), 1000);

    // Iframe content loaded — wait 1.5s more for components to render, then reveal
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setRevealedProjects((s) => new Set(s).add(pid));
      clearTimeout(t1);
      clearTimeout(t2);
    }, 1500);
  }, [blueEngine, sendBlueEngineConfig]);

  const [undoing, setUndoing] = useState(false);
  const [redoing, setRedoing] = useState(false);

  // ── Ship state with self-healing ──
  const MAX_SHIP_FIX_ATTEMPTS = 3;
  const [shipState, setShipState] = useState<ShipState>("idle");
  const [shipLogs, setShipLogs] = useState<string[]>([]);
  const shipLogsRef = useRef<string[]>([]);
  const shipFixAttemptRef = useRef(0);
  const shipCancelledRef = useRef(false);
  const unlistenShipRef = useRef<UnlistenFn | null>(null);

  // Reset ship state when switching projects, and restore saved ship logs
  useEffect(() => {
    setShipState("idle");
    setShipLogs([]);
    shipLogsRef.current = [];
    shipFixAttemptRef.current = 0;
    shipCancelledRef.current = false;

    loadShipLogs(projectId).then((saved) => {
      if (saved.length > 0) {
        shipLogsRef.current = saved;
        setShipLogs(saved);
      }
    }).catch(() => {});
  }, [projectId]);

  // Cleanup listener on unmount
  useEffect(() => {
    return () => { unlistenShipRef.current?.(); };
  }, []);

  const appendShipLog = useCallback((line: string) => {
    shipLogsRef.current = [...shipLogsRef.current, line];
    setShipLogs(shipLogsRef.current);
  }, []);

  const startShipBuild = useCallback(async (pid: string, name?: string) => {
    // Remove previous listener if any
    unlistenShipRef.current?.();

    return new Promise<"done" | "error">((resolve) => {
      listen<{ project_id: string; kind: string; message: string }>("ship-log", (event) => {
        if (event.payload.project_id !== pid) return;

        if (event.payload.kind === "log") {
          appendShipLog(event.payload.message);
        } else if (event.payload.kind === "done") {
          appendShipLog("");
          appendShipLog("── Ship complete!");
          resolve("done");
        } else if (event.payload.kind === "error") {
          appendShipLog(`ERROR: ${event.payload.message}`);
          resolve("error");
        }
      }).then((fn) => {
        unlistenShipRef.current = fn;
      });

      shipProject(pid, name).catch((err) => {
        appendShipLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        resolve("error");
      });
    });
  }, [appendShipLog]);

  const handleShip = useCallback(async () => {
    if (shipState === "shipping" || shipState === "fixing") return;

    setShipState("shipping");
    shipLogsRef.current = ["── Starting ship process..."];
    setShipLogs(shipLogsRef.current);
    shipFixAttemptRef.current = 0;
    shipCancelledRef.current = false;
    setActiveTab("code");

    let result = await startShipBuild(projectId, activeProject.title);

    // Self-healing loop: if build fails, try to fix and rebuild
    while (result === "error" && shipFixAttemptRef.current < MAX_SHIP_FIX_ATTEMPTS && !shipCancelledRef.current) {
      shipFixAttemptRef.current++;
      const attempt = shipFixAttemptRef.current;

      appendShipLog("");
      appendShipLog(`── Auto-fix attempt ${attempt}/${MAX_SHIP_FIX_ATTEMPTS}...`);
      setShipState("fixing");

      const provider = getProviderById(getActiveProviderId());
      if (!provider) {
        appendShipLog("[ship-fix] No AI provider available — giving up");
        break;
      }

      if (shipCancelledRef.current) { appendShipLog("── Cancelled."); break; }

      try {
        const fixResult = await attemptShipFix({
          provider,
          projectId,
          shipLogs: shipLogsRef.current,
          onLog: appendShipLog,
        });

        if (shipCancelledRef.current) { appendShipLog("── Cancelled."); break; }

        if (!fixResult.fixed) {
          appendShipLog(`[ship-fix] Could not fix: ${fixResult.label || "no patches produced"}`);
          break;
        }

        // Fix applied — rebuild
        appendShipLog("");
        appendShipLog("── Rebuilding after fix...");
        setShipState("shipping");
        result = await startShipBuild(projectId, activeProject.title);
      } catch (err) {
        if (shipCancelledRef.current) { appendShipLog("── Cancelled."); break; }
        appendShipLog(`[ship-fix] Fix attempt crashed: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }

    // Cleanup listener
    unlistenShipRef.current?.();
    unlistenShipRef.current = null;

    // Persist ship logs to disk
    if (shipLogsRef.current.length > 0) {
      saveShipLogs(projectId, shipLogsRef.current).catch(() => {});
    }

    if (result === "done") {
      setShipState("shipped");
      playShipDing();
    } else {
      setShipState("error");
      setTimeout(() => setShipState((s) => s === "error" ? "idle" : s), 10000);
    }
  }, [shipState, projectId, activeProject.title, startShipBuild, appendShipLog]);

  const handleOpenApp = useCallback(async () => {
    try {
      await launchShippedApp(projectId);
    } catch {
      // ignore
    }
  }, [projectId]);

  // Poll for preview server logs when code tab is active and server is running
  const prevServerLogsRef = useRef<string>("");
  useEffect(() => {
    if (activeTab !== "code" || !previewUrl) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await getPreviewLogs(projectId);
        if (cancelled) return;
        const next = [...result.stdout_tail, ...result.stderr_tail];
        // Only update state if content actually changed (avoids Shiki re-processing)
        const key = next.join("\n");
        if (key !== prevServerLogsRef.current) {
          prevServerLogsRef.current = key;
          setServerLogs(next);
        }
      } catch {
        // server not running yet
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTab, projectId, previewUrl]);

  // Clear server logs when switching projects
  useEffect(() => {
    setServerLogs([]);
  }, [projectId]);

  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  // ── Runtime console errors from the iframe ──
  const runtimeErrorsRef = useRef<string[]>([]);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);

  // Listen for postMessage from iframe's console capture
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object" || msg.type !== "runtime-console") return;
      const { level, message } = msg.payload ?? {};
      if (typeof message !== "string") return;
      // Only capture errors and significant warnings (skip noisy vite/hmr warnings)
      if (level === "error" || (level === "warn" && !message.includes("React Router Future Flag") && !message.includes("[vite]"))) {
        const line = `[${level}] ${message}`;
        // Deduplicate consecutive identical errors
        if (runtimeErrorsRef.current[runtimeErrorsRef.current.length - 1] !== line) {
          runtimeErrorsRef.current = [...runtimeErrorsRef.current, line];
          // Cap at 100 entries
          if (runtimeErrorsRef.current.length > 100) {
            runtimeErrorsRef.current = runtimeErrorsRef.current.slice(-100);
          }
          setRuntimeErrors(runtimeErrorsRef.current);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Reset runtime errors on project switch
  useEffect(() => {
    runtimeErrorsRef.current = [];
    setRuntimeErrors([]);
  }, [projectId]);

  // Expose runtime errors to the generation session via shared ref
  useEffect(() => {
    genRuntimeErrorsRef.current = () => runtimeErrorsRef.current;
    return () => { genRuntimeErrorsRef.current = null; };
  }, [genRuntimeErrorsRef]);

  // Merge generation logs + server logs (ship logs are shown in the bottom drawer)
  const allLogs = useMemo(() => {
    const lines = [...generationLogs];
    if (serverLogs.length > 0) {
      lines.push("", "── Preview Server ──");
      lines.push(...serverLogs);
    }
    if (runtimeErrors.length > 0) {
      lines.push("", "── Runtime Console ──");
      lines.push(...runtimeErrors);
    }
    return lines;
  }, [generationLogs, serverLogs, runtimeErrors]);

  // Collapsible blocks (file content + search/replace)
  const { processed: displayLogs, markers, toggle: toggleBlock } = useCollapsibleLogs(allLogs);

  // Syntax highlighting via Shiki — only process when code tab is visible
  const { appearance } = useAppearance();
  const isDark = appearance === "midnight";
  const shikiInput = activeTab === "code" ? displayLogs : [];
  const highlightMap = useShikiHighlight(shikiInput, isDark);

  // Virtualized list ref for auto-scroll
  const virtualListRef = useListRef(null);
  const userScrolledUpRef = useRef(false);
  const prevLogCountRef = useRef(0);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const [codeContainerHeight, setCodeContainerHeight] = useState(400);

  // Measure container height for virtual list
  useEffect(() => {
    const el = codeContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setCodeContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset scroll tracking when logs are cleared (new generation)
  useEffect(() => {
    if (displayLogs.length === 0) {
      userScrolledUpRef.current = false;
      prevLogCountRef.current = 0;
    }
  }, [displayLogs.length]);

  // Auto-scroll virtual list to bottom when new logs arrive
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    if (displayLogs.length > prevLogCountRef.current && displayLogs.length > 0) {
      requestAnimationFrame(() => {
        virtualListRef.current?.scrollToRow({ index: displayLogs.length - 1, align: "end" });
      });
    }
    prevLogCountRef.current = displayLogs.length;
  }, [displayLogs]);

  const handleStop = useCallback(() => {
    stopPreview(projectId);
    cancel(projectId);
  }, [stopPreview, cancel, projectId]);

  const handleUndo = useCallback(async () => {
    setUndoing(true);
    try {
      await undoLast(projectId);
    } finally {
      setUndoing(false);
    }
  }, [undoLast, projectId]);

  const handleRedo = useCallback(async () => {
    setRedoing(true);
    try {
      await redoNext(projectId);
    } finally {
      setRedoing(false);
    }
  }, [redoNext, projectId]);

  const [copied, setCopied] = useState(false);

  const handleCopyLogs = useCallback(() => {
    const text = allLogs.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [allLogs]);

  const busy = undoing || redoing;
  const canUndo = undoStack.length > 0 && !isRunning && !busy;
  const canRedo = redoStack.length > 0 && !isRunning && !busy;
  const showToolbar = previewUrl || canUndo || canRedo;

  // ── Error toast ──
  const [toastDismissed, setToastDismissed] = useState(false);
  const prevErrorRef = useRef<string | null>(null);

  // Derive error message from generation or ship failures
  const errorMessage = status.phase === "failed" && status.error
    ? status.error.title
    : shipState === "error"
      ? "Ship failed"
      : null;

  // Reset dismissed state when a new error appears
  useEffect(() => {
    if (errorMessage && errorMessage !== prevErrorRef.current) {
      setToastDismissed(false);
    }
    prevErrorRef.current = errorMessage;
  }, [errorMessage]);

  const showToast = !!errorMessage && !toastDismissed && activeTab === "ui";

  // ── Ship drawer ──
  const [shipDrawerOpen, setShipDrawerOpen] = useState(false);
  const shipDrawerRef = useRef<HTMLDivElement>(null);
  const hasShipLogs = shipLogs.length > 0;

  // Auto-open drawer when shipping starts (close blue-engine drawer to avoid overlap)
  useEffect(() => {
    if (shipState === "shipping" || shipState === "fixing") {
      setShipDrawerOpen(true);
      setBeDrawerOpen(false);
    }
  }, [shipState]);

  // Auto-scroll ship drawer to bottom
  useEffect(() => {
    if (shipDrawerOpen && shipDrawerRef.current) {
      requestAnimationFrame(() => {
        shipDrawerRef.current!.scrollTop = shipDrawerRef.current!.scrollHeight;
      });
    }
  }, [shipLogs.length, shipDrawerOpen]);

  // ── Blue-engine log drawer ──
  type BlueEngineState = "idle" | "running" | "stopped" | "error";
  const [beState, setBeState] = useState<BlueEngineState>("idle");
  const [beLogs, setBeLogs] = useState<string[]>([]);
  const beLogsRef = useRef<string[]>([]);
  const [beDrawerOpen, setBeDrawerOpen] = useState(false);
  const beDrawerRef = useRef<HTMLDivElement>(null);
  const unlistenBeRef = useRef<UnlistenFn | null>(null);
  const hasBeLogs = beLogs.length > 0;

  // Listen for blue-engine-log events
  useEffect(() => {
    unlistenBeRef.current?.();
    unlistenBeRef.current = null;

    listen<{ project_id: string; message: string }>("blue-engine-log", (event) => {
      if (event.payload.project_id !== projectId) return;
      beLogsRef.current = [...beLogsRef.current, event.payload.message];
      setBeLogs(beLogsRef.current);
    }).then((fn) => { unlistenBeRef.current = fn; });

    return () => { unlistenBeRef.current?.(); };
  }, [projectId]);

  // Track blue-engine state from blueEngine context
  // Also re-send config to any loaded iframe when blueEngine becomes available (late arrival)
  useEffect(() => {
    if (blueEngine) {
      setBeState("running");
      if (beLogsRef.current.length === 0) {
        beLogsRef.current = [`── Blue-engine started on port ${blueEngine.port}`, `  Commands: ${blueEngine.commands.join(", ") || "(none)"}`];
        setBeLogs(beLogsRef.current);
      }
      // Re-send config to all loaded iframes in case they loaded before blue-engine was ready
      for (const [, iframe] of Object.entries(iframeRefs.current)) {
        if (iframe?.contentWindow) {
          try {
            iframe.contentWindow.postMessage(
              { type: "blue-engine-config", port: blueEngine.port, invokeKey: blueEngine.invoke_key },
              "*",
            );
          } catch { /* cross-origin */ }
        }
      }
    }
  }, [blueEngine]);

  // Reset blue-engine logs when switching projects
  useEffect(() => {
    setBeState("idle");
    setBeLogs([]);
    beLogsRef.current = [];
  }, [projectId]);

  // Auto-scroll blue-engine drawer
  useEffect(() => {
    if (beDrawerOpen && beDrawerRef.current) {
      requestAnimationFrame(() => {
        beDrawerRef.current!.scrollTop = beDrawerRef.current!.scrollHeight;
      });
    }
  }, [beLogs.length, beDrawerOpen]);

  const handleStopBlueEngine = useCallback(async () => {
    try {
      await stopBlueEngine(projectId);
      setBeState("stopped");
      beLogsRef.current = [...beLogsRef.current, "", "── Stopped by user."];
      setBeLogs(beLogsRef.current);
    } catch {
      // ignore
    }
  }, [projectId]);

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden"
      style={{ background: "var(--pane-bg)", position: "relative" }}
    >
      {sketchOpen && (
        <div style={{ position: "absolute", inset: 0, zIndex: 30 }}>
          <SketchCanvas
            initialData={sketchData}
            onInsert={sketchInsert}
            onClose={closeSketch}
          />
        </div>
      )}
      <PreviewHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        canShip={!!previewUrl && !isRunning}
        shipState={shipState}
        onShip={handleShip}
        onOpenApp={handleOpenApp}
      />
      <div className="flex-1 relative overflow-hidden">
        {/* ── Code tab — always mounted, hidden via display ── */}
        <div
          className="absolute inset-0"
          style={{ padding: 6, display: activeTab === "code" ? undefined : "none" }}
        >
          <div
            ref={codeContainerRef}
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid var(--separator-color)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
              background: "var(--pane-bg)",
            }}
          >
            {displayLogs.length === 0 && !hasStarted && (
              <div style={{
                padding: "14px 18px",
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 12.5,
              }}>
                <p style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>
                  No output yet. Start generating an app to see logs here.
                </p>
              </div>
            )}
            {displayLogs.length === 0 && hasStarted && (
              <div style={{
                padding: "14px 18px",
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 12.5,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-tertiary)",
              }}>
                <div style={{
                  width: 10, height: 10,
                  border: "1.5px solid var(--separator-color)",
                  borderTopColor: "var(--slider-thumb)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }} />
                <span style={{ fontStyle: "italic" }}>Starting generation...</span>
              </div>
            )}
            {displayLogs.length > 0 && (
              <VirtualList
                listRef={virtualListRef}
                rowCount={displayLogs.length}
                rowHeight={22}
                className="rain-scroll"
                style={{ height: codeContainerHeight, padding: "14px 0" }}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  userScrolledUpRef.current = !nearBottom;
                }}
                rowComponent={LogRow as any}
                rowProps={{ logs: displayLogs, highlightMap, markers, onToggle: toggleBlock } as any}
              />
            )}
          </div>
        </div>

        {/* ── UI tab — always mounted, hidden via display ── */}
        <div
          className="absolute inset-0"
          style={{ display: activeTab === "ui" ? undefined : "none" }}
        >
          {previewUrl ? (
            <div className="absolute inset-0" style={{ padding: 6 }}>
              <div style={{
                width: "100%",
                height: "100%",
                borderRadius: 10,
                overflow: "hidden",
                background: "var(--pane-bg)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
                border: "1px solid var(--separator-color)",
                position: "relative",
              }}>
                {/* Iframe loads in background — hidden until morphism reveal completes */}
                {Object.entries(allPreviewUrls).map(([pid, url]) => (
                  <iframe
                    key={pid}
                    ref={(el) => { iframeRefs.current[pid] = el; }}
                    src={url}
                    onLoad={() => handleIframeLoad(pid)}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "none",
                      display: pid === projectId ? "block" : "none",
                    }}
                    title={`Preview ${pid}`}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  />
                ))}
              </div>
              {/* Server error banner */}
              {serverError && isRevealed && (
                <div style={{
                  position: "absolute",
                  bottom: 12,
                  left: 12,
                  right: 12,
                  zIndex: 25,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 11,
                  color: "#c44",
                  background: "rgba(255,240,240,0.9)",
                  backdropFilter: "blur(4px)",
                }}>
                  {serverError}
                </div>
              )}
            </div>
          ) : hasStarted && isRunning ? (
            <GenerationOverlay status={status} />
          ) : hasStarted ? (
            /* Empty — morphism overlay below covers this state */
            null
          ) : (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 4,
            }}>
              <EmptyIllustration />
              <p style={{
                paddingTop: 20,
                fontSize: 30,
                fontWeight: 600,
                color: "var(--text-secondary)",
                opacity: 0.2,
                marginTop: 12,
              }}>
                No preview yet
              </p>
            </div>
          )}
        </div>

        {/* ── Single persistent morphism overlay ── */}
        {/* Covers both "starting dev server" and "preparing app" states with no DOM flash */}
        {activeTab === "ui" && hasStarted && !isRunning && !isRevealed && (
          <div style={{
            position: "absolute",
            inset: 0,
            zIndex: 15,
            background: "var(--morphism-bg)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}>
            {/* Animated gradient blobs */}
            <div style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              borderRadius: 10,
            }}>
              <div style={{
                position: "absolute",
                width: "120%",
                height: "120%",
                top: "-10%",
                left: "-10%",
                background: "radial-gradient(ellipse at 30% 30%, var(--orb-color-3) 0%, transparent 60%), radial-gradient(ellipse at 70% 70%, var(--orb-color-1) 0%, transparent 60%)",
                opacity: 0.25,
                animation: "morphism-shift 8s ease-in-out infinite alternate",
              }} />
            </div>

            {/* Centered orb + status text */}
            <div style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}>
              <div style={{
                position: "relative",
                width: 52,
                height: 52,
                marginBottom: 16,
              }}>
                <div style={{
                  position: "absolute",
                  inset: -10,
                  borderRadius: "50%",
                  background: "var(--orb-glow)",
                  filter: "blur(14px)",
                  animation: "orb-pulse 3s ease-in-out infinite",
                }} />
                <div style={{
                  position: "relative",
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: "radial-gradient(circle at 35% 35%, var(--orb-color-3), var(--orb-color-1) 50%, var(--orb-color-2) 100%)",
                  boxShadow: "0 4px 20px var(--orb-glow), inset 0 -4px 12px rgba(0,0,0,0.08), inset 0 4px 8px rgba(255,255,255,0.3)",
                  animation: "orb-pulse 3s ease-in-out infinite",
                }}>
                  <div style={{
                    position: "absolute",
                    top: 8,
                    left: 12,
                    width: 18,
                    height: 12,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.35)",
                    filter: "blur(5px)",
                  }} />
                </div>
              </div>
              <p style={{
                fontSize: 16,
                fontWeight: 500,
                color: "var(--text-secondary)",
                opacity: 0.7,
              }}>
                {previewUrl ? "Preparing your app…" : "Starting dev server…"}
              </p>
            </div>
          </div>
        )}

        {/* Fade-out reveal — covers iframe while opacity animates from 1→0 */}
        {activeTab === "ui" && isRevealed && previewUrl && (
          <div style={{
            position: "absolute",
            inset: 0,
            zIndex: 15,
            background: "var(--morphism-bg)",
            animation: "preview-reveal 0.6s ease-out forwards",
            pointerEvents: "none",
          }} />
        )}

        {/* ── Error toast ── */}
        {showToast && (
          <div style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 22,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 6px 8px 14px",
            borderRadius: 12,
            background: "var(--pane-bg)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(200,60,60,0.15)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.08), 0 0 0 1px rgba(200,60,60,0.05)",
            animation: "toast-slide-in 0.25s ease-out both",
            maxWidth: "85%",
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#d55",
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {errorMessage}
            </span>
            <button
              onClick={() => { setToastDismissed(true); setActiveTab("code"); }}
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: "var(--text-tertiary)",
                background: "var(--btn-subtle-hover-bg)",
                border: "none",
                borderRadius: 7,
                padding: "3px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              View logs
            </button>
            <button
              onClick={() => setToastDismissed(true)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
                flexShrink: 0,
                opacity: 0.5,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
            >
              ×
            </button>
          </div>
        )}

        {/* Floating toolbar — Undo / Stop / Redo */}
        {showToolbar && (
          <div style={{
            position: "absolute",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: 4,
            borderRadius: 12,
            background: "var(--pane-bg)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--separator-color)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}>
            {/* Undo */}
            <button
              className="flex items-center justify-center rounded-lg transition-colors h-7 w-7"
              title="Undo"
              disabled={!canUndo}
              style={{
                background: "transparent",
                border: "none",
                color: canUndo ? "var(--text-primary)" : "var(--text-tertiary)",
                cursor: canUndo ? "pointer" : "default",
                opacity: canUndo ? 1 : 0.35,
              }}
              onClick={handleUndo}
              onMouseEnter={(e) => { if (canUndo) { e.currentTarget.style.background = "var(--btn-subtle-hover-bg)"; e.currentTarget.style.color = "var(--btn-subtle-hover-text)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = canUndo ? "var(--text-primary)" : "var(--text-tertiary)"; }}
            >
              <Undo2 size={14} strokeWidth={1.8} />
            </button>

            {/* Stop */}
            {previewUrl && (
              <button
                className="flex items-center justify-center rounded-lg transition-colors h-7 w-7"
                title="Stop Preview"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#e55",
                  cursor: "pointer",
                }}
                onClick={handleStop}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(238,85,85,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Square size={13} strokeWidth={2} fill="currentColor" />
              </button>
            )}

            {/* Redo */}
            <button
              className="flex items-center justify-center rounded-lg transition-colors h-7 w-7"
              title="Redo"
              disabled={!canRedo}
              style={{
                background: "transparent",
                border: "none",
                color: canRedo ? "var(--text-primary)" : "var(--text-tertiary)",
                cursor: canRedo ? "pointer" : "default",
                opacity: canRedo ? 1 : 0.35,
              }}
              onClick={handleRedo}
              onMouseEnter={(e) => { if (canRedo) { e.currentTarget.style.background = "var(--btn-subtle-hover-bg)"; e.currentTarget.style.color = "var(--btn-subtle-hover-text)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = canRedo ? "var(--text-primary)" : "var(--text-tertiary)"; }}
            >
              <Redo2 size={14} strokeWidth={1.8} />
            </button>
          </div>
        )}

        {/* ── Open in editor pill ── */}
        {hasStarted && activeTab === "code" && allLogs.length > 0 && (
          <div ref={editorPickerRef} style={{
            position: "absolute",
            top: 14,
            right: 14,
            zIndex: 24,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            {/* Open in editor + dropdown */}
            {activeEditor && <div style={{ position: "relative" }}>
              <button
                onClick={handleOpenInEditor}
                title={`Open in ${activeEditor.name}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 8,
                  background: "var(--pane-bg)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: "1px solid var(--separator-color)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
              >
                <EditorIcon editorId={activeEditor.id} size={14} />
                <span>Open</span>
                {allEditors.length > 1 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setEditorPickerOpen((v) => !v); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginLeft: -2,
                      padding: "0 1px",
                      color: "var(--text-tertiary)",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                  >
                    <ChevronDown size={11} strokeWidth={2} style={{
                      transform: editorPickerOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                    }} />
                  </span>
                )}
              </button>

              {/* Editor picker dropdown */}
              {editorPickerOpen && (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  minWidth: 180,
                  padding: 4,
                  borderRadius: 9,
                  border: "1px solid var(--separator-color)",
                  background: "var(--pane-bg)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  zIndex: 26,
                  maxHeight: 320,
                  overflowY: "auto",
                }}>
                  {allEditors.map((ed) => (
                    <button
                      key={ed.id}
                      disabled={!ed.installed}
                      onClick={() => {
                        if (!ed.installed) return;
                        setActiveEditor(ed);
                        setEditorPickerOpen(false);
                        openInEditor(projectId, ed.id).catch(() => {});
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "6px 10px",
                        border: "none",
                        borderRadius: 6,
                        background: ed.id === activeEditor?.id ? "var(--btn-muted-bg)" : "transparent",
                        cursor: ed.installed ? "pointer" : "default",
                        fontSize: 12,
                        fontFamily: "inherit",
                        color: ed.installed ? "var(--text-primary)" : "var(--text-tertiary)",
                        opacity: ed.installed ? 1 : 0.45,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { if (ed.installed) e.currentTarget.style.background = "var(--btn-muted-bg)"; }}
                      onMouseLeave={(e) => { if (ed.installed) e.currentTarget.style.background = ed.id === activeEditor?.id ? "var(--btn-muted-bg)" : "transparent"; }}
                    >
                      <EditorIcon editorId={ed.id} size={16} />
                      <span>{ed.name}</span>
                      {ed.id === activeEditor?.id && (
                        <Check size={12} strokeWidth={2} style={{ marginLeft: "auto", color: "var(--slider-thumb)" }} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>}

            {/* Copy logs */}
            <button
              onClick={handleCopyLogs}
              title="Copy logs"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px 7px",
                borderRadius: 8,
                background: "var(--pane-bg)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--separator-color)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                cursor: "pointer",
                color: copied ? "#2a8" : "var(--text-tertiary)",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.8} />}
            </button>
          </div>
        )}

        {/* ── Ship terminal drawer ── */}
        {hasShipLogs && activeTab === "code" && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 6,
              right: 6,
              zIndex: 25,
              display: "flex",
              flexDirection: "column",
              maxHeight: shipDrawerOpen ? "55%" : 0,
              transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              overflow: "hidden",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
              border: "1px solid var(--separator-color)",
              borderBottom: "none",
              boxShadow: "0 -2px 12px rgba(0,0,0,0.08)",
            }}
          >
            {/* Drawer handle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 12px",
                background: "var(--input-bg, var(--pane-bg))",
                borderBottom: shipDrawerOpen ? "1px solid var(--separator-color)" : "none",
                color: "var(--text-secondary)",
                fontSize: 11.5,
                fontWeight: 500,
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                letterSpacing: 0.2,
                flexShrink: 0,
                cursor: "pointer",
              }}
              onClick={() => { setShipDrawerOpen((o) => !o); setBeDrawerOpen(false); }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <Terminal size={12} strokeWidth={1.8} />
              <span>Ship Log</span>
              {(shipState === "shipping" || shipState === "fixing") && (
                <div style={{
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "var(--slider-thumb)",
                  animation: "orb-pulse 1.5s ease-in-out infinite",
                  flexShrink: 0,
                }} />
              )}
              {shipState === "shipped" && (
                <Check size={11} strokeWidth={2.5} style={{ color: "#2a8" }} />
              )}
              {shipState === "error" && (
                <div style={{
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "#d55",
                  flexShrink: 0,
                }} />
              )}
              <div style={{ flex: 1 }} />
              {(shipState === "shipping" || shipState === "fixing") && (
                <div
                  style={{ position: "relative", zIndex: 2 }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onMouseEnter={(e) => e.stopPropagation()}
                  onMouseLeave={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      shipCancelledRef.current = true;
                      setShipState("error");
                      appendShipLog("── Cancelled by user.");
                      cancelShip(projectId).catch(() => {});
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#d55";
                      e.currentTarget.style.borderColor = "#d55";
                      e.currentTarget.style.background = "rgba(221,85,85,0.06)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-tertiary)";
                      e.currentTarget.style.borderColor = "var(--separator-color)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      borderRadius: 5,
                      fontSize: 10.5,
                      fontWeight: 500,
                      color: "var(--text-tertiary)",
                      background: "transparent",
                      border: "1px solid var(--separator-color)",
                      cursor: "pointer",
                      transition: "color 0.15s, border-color 0.15s, background 0.15s",
                      letterSpacing: 0.1,
                      lineHeight: 1,
                      fontFamily: "inherit",
                    }}
                  >
                    <Square size={8} strokeWidth={2.5} />
                    <span>Stop</span>
                  </button>
                </div>
              )}
              {shipDrawerOpen
                ? <ChevronDown size={13} strokeWidth={1.8} />
                : <ChevronUp size={13} strokeWidth={1.8} />
              }
            </div>

            {/* Drawer content */}
            <div
              ref={shipDrawerRef}
              className="rain-scroll"
              style={{
                flex: 1,
                overflow: "auto",
                background: "var(--input-bg, var(--pane-bg))",
                padding: "8px 0",
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 11.5,
                lineHeight: 1.7,
              }}
            >
              {shipLogs.map((line, i) => {
                const isErr = line.includes("ERROR") || line.includes("failed");
                const isOk = line.includes("complete") || line.includes("ready") || line.includes("Installed");
                const isSection = line.startsWith("──");
                return (
                  <div
                    key={i}
                    style={{
                      padding: "0 14px",
                      color: isErr ? "#d55"
                        : isOk ? "#2a8"
                        : isSection ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      fontWeight: isSection ? 500 : 400,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      minHeight: line === "" ? 10 : undefined,
                    }}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsed drawer tab — shown when drawer is closed and ship logs exist */}
        {hasShipLogs && activeTab === "code" && !shipDrawerOpen && (
          <button
            onClick={() => { setShipDrawerOpen(true); setBeDrawerOpen(false); }}
            style={{
              position: "absolute",
              bottom: 14,
              right: 14,
              zIndex: 24,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 8,
              background: "var(--pane-bg)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--separator-color)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              cursor: "pointer",
              color: "var(--text-secondary)",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            <Terminal size={11} strokeWidth={1.8} />
            <span>Ship Log</span>
            {(shipState === "shipping" || shipState === "fixing") && (
              <div style={{
                width: 5, height: 5,
                borderRadius: "50%",
                background: "var(--slider-thumb)",
                animation: "orb-pulse 1.5s ease-in-out infinite",
              }} />
            )}
            {shipState === "shipped" && (
              <Check size={10} strokeWidth={2.5} style={{ color: "#2a8" }} />
            )}
            {shipState === "error" && (
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#d55" }} />
            )}
            <ChevronUp size={11} strokeWidth={1.8} />
          </button>
        )}

        {/* ── Blue-engine terminal drawer ── */}
        {hasBeLogs && activeTab === "code" && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 6,
              right: 6,
              zIndex: shipDrawerOpen ? 23 : 25,
              display: "flex",
              flexDirection: "column",
              maxHeight: beDrawerOpen ? "55%" : 0,
              transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              overflow: "hidden",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
              border: "1px solid var(--separator-color)",
              borderBottom: "none",
              boxShadow: "0 -2px 12px rgba(0,0,0,0.08)",
            }}
          >
            {/* Drawer handle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "5px 12px",
                background: "var(--input-bg, var(--pane-bg))",
                borderBottom: beDrawerOpen ? "1px solid var(--separator-color)" : "none",
                color: "var(--text-secondary)",
                fontSize: 11.5,
                fontWeight: 500,
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                letterSpacing: 0.2,
                flexShrink: 0,
                cursor: "pointer",
              }}
              onClick={() => { setBeDrawerOpen((o) => !o); setShipDrawerOpen(false); }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <Zap size={12} strokeWidth={1.8} />
              <span>Blue Engine</span>
              {beState === "running" && (
                <div style={{
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "#4a9eff",
                  animation: "orb-pulse 1.5s ease-in-out infinite",
                  flexShrink: 0,
                }} />
              )}
              {beState === "stopped" && (
                <div style={{
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "var(--text-tertiary)",
                  flexShrink: 0,
                }} />
              )}
              {beState === "error" && (
                <div style={{
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "#d55",
                  flexShrink: 0,
                }} />
              )}
              <div style={{ flex: 1 }} />
              {beState === "running" && (
                <div
                  style={{ position: "relative", zIndex: 2 }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onMouseEnter={(e) => e.stopPropagation()}
                  onMouseLeave={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleStopBlueEngine}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#d55";
                      e.currentTarget.style.borderColor = "#d55";
                      e.currentTarget.style.background = "rgba(221,85,85,0.06)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-tertiary)";
                      e.currentTarget.style.borderColor = "var(--separator-color)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      borderRadius: 5,
                      fontSize: 10.5,
                      fontWeight: 500,
                      color: "var(--text-tertiary)",
                      background: "transparent",
                      border: "1px solid var(--separator-color)",
                      cursor: "pointer",
                      transition: "color 0.15s, border-color 0.15s, background 0.15s",
                      letterSpacing: 0.1,
                      lineHeight: 1,
                      fontFamily: "inherit",
                    }}
                  >
                    <Square size={8} strokeWidth={2.5} />
                    <span>Stop</span>
                  </button>
                </div>
              )}
              {beDrawerOpen
                ? <ChevronDown size={13} strokeWidth={1.8} />
                : <ChevronUp size={13} strokeWidth={1.8} />
              }
            </div>

            {/* Drawer content */}
            <div
              ref={beDrawerRef}
              className="rain-scroll"
              style={{
                flex: 1,
                overflow: "auto",
                background: "var(--input-bg, var(--pane-bg))",
                padding: "8px 0",
                fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 11.5,
                lineHeight: 1.7,
              }}
            >
              {beLogs.map((line, i) => {
                const isErr = /error|fail|ERR/i.test(line);
                const isOk = /ready|started|complete|success/i.test(line);
                const isSection = line.startsWith("──");
                const isAgent = /\[agent\]/i.test(line);
                return (
                  <div
                    key={i}
                    style={{
                      padding: "0 14px",
                      color: isErr ? "#d55"
                        : isOk ? "#2a8"
                        : isAgent ? "#4a9eff"
                        : isSection ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      fontWeight: isSection ? 500 : 400,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      minHeight: line === "" ? 10 : undefined,
                    }}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsed blue-engine tab — shown when drawer is closed and logs exist */}
        {hasBeLogs && activeTab === "code" && !beDrawerOpen && (
          <button
            onClick={() => { setBeDrawerOpen(true); setShipDrawerOpen(false); }}
            style={{
              position: "absolute",
              bottom: 14,
              right: hasShipLogs && !shipDrawerOpen ? 130 : 14,
              zIndex: 24,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 8,
              background: "var(--pane-bg)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--separator-color)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              cursor: "pointer",
              color: "var(--text-secondary)",
              fontSize: 11,
              fontWeight: 500,
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              transition: "color 0.15s, right 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            <Zap size={11} strokeWidth={1.8} />
            <span>Blue Engine</span>
            {beState === "running" && (
              <div style={{
                width: 5, height: 5,
                borderRadius: "50%",
                background: "#4a9eff",
                animation: "orb-pulse 1.5s ease-in-out infinite",
              }} />
            )}
            {beState === "stopped" && (
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--text-tertiary)" }} />
            )}
            {beState === "error" && (
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#d55" }} />
            )}
            <ChevronUp size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}
