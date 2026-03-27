import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
import { startPreviewServer, stopPreviewServer, startBlueEngine, stopBlueEngine, type BlueEngineInfo } from "../tauri/workspace";
import { useProjectContext } from "../project/ProjectContext";

interface ProjectPreviewState {
  previewUrl: string | null;
  overlayText: string | null;
  serverError: string | null;
  blueEngine: BlueEngineInfo | null;
}

const INITIAL_PREVIEW: ProjectPreviewState = {
  previewUrl: null,
  overlayText: null,
  serverError: null,
  blueEngine: null,
};

interface PreviewCtx {
  /** State for the currently active project */
  previewUrl: string | null;
  overlayText: string | null;
  serverError: string | null;
  /** Blue-engine info for the active project (null if no backend commands). */
  blueEngine: BlueEngineInfo | null;
  /** All project preview URLs — for rendering persistent iframes */
  allPreviewUrls: Record<string, string>;
  startPreview: (projectId: string, port?: number) => Promise<void>;
  stopPreview: (projectId: string) => Promise<void>;
}

const PreviewContext = createContext<PreviewCtx>({
  previewUrl: null,
  overlayText: null,
  serverError: null,
  blueEngine: null,
  allPreviewUrls: {},
  startPreview: async () => {},
  stopPreview: async () => {},
});

export function PreviewProvider({ children }: { children: ReactNode }) {
  const { activeId } = useProjectContext();
  const [previews, setPreviews] = useState<Record<string, ProjectPreviewState>>({});

  const updatePreview = useCallback((id: string, update: Partial<ProjectPreviewState>) => {
    setPreviews((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? INITIAL_PREVIEW), ...update },
    }));
  }, []);

  // Guard against concurrent startPreview calls for the same project
  const startingRef = useRef<Set<string>>(new Set());

  const startPreview = useCallback(async (projectId: string, port?: number) => {
    if (startingRef.current.has(projectId)) return; // Already starting — skip
    startingRef.current.add(projectId);

    updatePreview(projectId, { overlayText: "Starting preview…", serverError: null });

    // Stop any existing preview server for this project before starting fresh
    try { await stopPreviewServer(projectId); } catch { /* ignore */ }

    try {
      // Start blue-engine in parallel (non-blocking — it's optional for non-system apps)
      const blueEnginePromise = startBlueEngine(projectId)
        .then((info) => {
          updatePreview(projectId, { blueEngine: info });
          return info;
        })
        .catch(() => null); // No backend commands — that's fine

      const result = await startPreviewServer(projectId, port);
      const url = `http://127.0.0.1:${result.port}`;

      // Wait for blue-engine to be ready before revealing preview
      await blueEnginePromise;

      // Poll until the server responds (up to 30s — npm install can take a while on first run)
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          await fetch(url, { mode: "no-cors" });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Set previewUrl — the iframe + morphism overlay handle the visual transition.
      // The iframe onLoad will trigger reveal once everything is actually ready.
      updatePreview(projectId, { previewUrl: url, overlayText: null });
    } catch (err) {
      updatePreview(projectId, { overlayText: null, serverError: err instanceof Error ? err.message : String(err) });
    } finally {
      startingRef.current.delete(projectId);
    }
  }, [updatePreview]);

  const stopPreview = useCallback(async (projectId: string) => {
    try {
      await Promise.all([
        stopPreviewServer(projectId),
        stopBlueEngine(projectId).catch(() => {}),
      ]);
    } catch {
      // ignore errors on stop
    }
    updatePreview(projectId, { previewUrl: null, overlayText: null, serverError: null });
  }, [updatePreview]);

  // Stop the previous project's dev server when switching projects
  const prevActiveId = useRef(activeId);
  useEffect(() => {
    const prev = prevActiveId.current;
    if (prev && prev !== activeId && previews[prev]?.previewUrl) {
      stopPreviewServer(prev).catch(() => {});
      setPreviews((p) => {
        const next = { ...p };
        delete next[prev];
        return next;
      });
    }
    prevActiveId.current = activeId;
  }, [activeId, previews]);

  const active = previews[activeId] ?? INITIAL_PREVIEW;

  // Only expose the active project's preview URL (single-project view)
  const allPreviewUrls = useMemo(() => {
    const result: Record<string, string> = {};
    if (active.previewUrl) result[activeId] = active.previewUrl;
    return result;
  }, [activeId, active.previewUrl]);

  const value = useMemo<PreviewCtx>(() => ({
    previewUrl: active.previewUrl,
    overlayText: active.overlayText,
    serverError: active.serverError,
    blueEngine: active.blueEngine,
    allPreviewUrls,
    startPreview,
    stopPreview,
  }), [active, allPreviewUrls, startPreview, stopPreview]);

  return (
    <PreviewContext.Provider value={value}>
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreviewContext() {
  return useContext(PreviewContext);
}
