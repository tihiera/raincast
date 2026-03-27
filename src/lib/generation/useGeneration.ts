import { useState, useRef, useCallback } from "react";
import { type GenerationStatus, INITIAL_STATUS } from "./types";
import { GenerationSession } from "./session";
import { getProviderById } from "../ai";
import { getActiveProviderId } from "../ai/settings";
import { rollbackSnapshot, reapplySnapshot, runValidation, checkProjectHasApp, saveGenerationLogs, loadGenerationLogs } from "../tauri/workspace";
import type { ChatMessage } from "../chat/types";
import type { LayoutArchetype } from "./templates";
import type { ScaffoldTier } from "./scaffolds";

interface ProjectGenState {
  status: GenerationStatus;
  isRunning: boolean;
  hasProject: boolean;
  generationLogs: string[];
  history: string[];
  cursor: number;
}

const INITIAL_PROJECT_STATE: ProjectGenState = {
  status: INITIAL_STATUS,
  isRunning: false,
  hasProject: false,
  generationLogs: [],
  history: [],
  cursor: -1,
};

export function useGeneration(runtimeErrorsRef?: React.RefObject<(() => string[]) | null>) {
  // Per-project generation state
  const [projects, setProjects] = useState<Record<string, ProjectGenState>>({});
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const sessionsRef = useRef<Record<string, GenerationSession>>({});
  const onFirstCheckpointRefs = useRef<Record<string, (() => void) | null>>({});

  // Helper to get a project's state (returns defaults if not yet initialized)
  const getProject = useCallback((id: string): ProjectGenState => {
    return projects[id] ?? INITIAL_PROJECT_STATE;
  }, [projects]);

  // Helper to update a specific field in a project's state
  const updateProject = useCallback((id: string, updater: (prev: ProjectGenState) => Partial<ProjectGenState>) => {
    setProjects((prev) => {
      const current = prev[id] ?? INITIAL_PROJECT_STATE;
      return { ...prev, [id]: { ...current, ...updater(current) } };
    });
  }, []);

  const cancel = useCallback((projectId: string) => {
    sessionsRef.current[projectId]?.cancel();
    delete sessionsRef.current[projectId];
    updateProject(projectId, () => ({
      isRunning: false,
      status: { phase: "idle", message: "Generation cancelled" },
    }));
  }, [updateProject]);

  const start = useCallback((
    projectId: string,
    messages: ChatMessage[],
    mode: "build" | "edit",
    reason?: string,
    onFirstCheckpoint?: () => void,
    onChatStatus?: (msg: ChatMessage) => void,
    onChatStatusAppend?: (id: string, textChunk: string) => void,
    layoutArchetype?: LayoutArchetype,
    onToolStatus?: (status: { text: string; tool?: string; args?: string } | null) => void,
    onProjectRenamed?: (newName: string) => void,
    scaffoldTier?: ScaffoldTier,
  ) => {
    const providerId = getActiveProviderId();
    const provider = getProviderById(providerId);
    if (!provider) {
      updateProject(projectId, () => ({
        status: { phase: "failed", error: { title: "No provider", detail: `${providerId} provider not available` } },
      }));
      return;
    }

    // Cancel any existing session for this project
    sessionsRef.current[projectId]?.cancel();
    onFirstCheckpointRefs.current[projectId] = onFirstCheckpoint ?? null;

    // Clear logs for new generation
    updateProject(projectId, () => ({
      generationLogs: [],
      isRunning: true,
      status: { phase: "planning", message: reason ?? "Analyzing requirements..." },
    }));

    const session = new GenerationSession({
      provider,
      projectId,
      messages,
      mode,
      scaffoldTier: scaffoldTier ?? "standard",
      layoutArchetype,
      onStatus: (s) => {
        console.log("[onStatus]", projectId, s.phase, s.message ?? "", s.checkpointLabel ?? "");
        updateProject(projectId, () => ({ status: s }));
      },
      onLog: (line) => {
        updateProject(projectId, (prev) => ({
          generationLogs: [...prev.generationLogs, line],
        }));
      },
      onSnapshotApplied: (snapshotId) => {
        updateProject(projectId, (prev) => {
          const base = prev.history.slice(0, prev.cursor + 1);
          return {
            history: [...base, snapshotId],
            cursor: prev.cursor + 1,
          };
        });
      },
      onSnapshotRolledBack: (count) => {
        updateProject(projectId, (prev) => ({
          cursor: Math.max(-1, prev.cursor - count),
        }));
      },
      onChatStatus: onChatStatus ?? undefined,
      onChatStatusAppend: onChatStatusAppend ?? undefined,
      onToolStatus: onToolStatus ?? undefined,
      onProjectRenamed: onProjectRenamed ?? undefined,
      getRuntimeErrors: runtimeErrorsRef ? () => (runtimeErrorsRef.current?.() ?? []) : undefined,
      onFirstCheckpointApplied: () => {
        updateProject(projectId, () => ({ hasProject: true }));
        onFirstCheckpointRefs.current[projectId]?.();
      },
    });

    sessionsRef.current[projectId] = session;

    session.run().then(() => {
      if (sessionsRef.current[projectId] === session) {
        updateProject(projectId, () => ({ isRunning: false }));
        // Persist generation logs to disk
        const logs = (projectsRef.current[projectId] ?? INITIAL_PROJECT_STATE).generationLogs;
        if (logs.length > 0) {
          saveGenerationLogs(projectId, logs).catch(() => {});
        }
      }
    });
  }, [updateProject]);

  const undoLast = useCallback(async (projectId: string) => {
    const proj = projects[projectId] ?? INITIAL_PROJECT_STATE;
    if (proj.cursor < 0) return;

    const snapshotId = proj.history[proj.cursor];
    updateProject(projectId, () => ({
      status: { phase: "validating", message: "Undoing last checkpoint..." },
    }));

    try {
      await rollbackSnapshot(projectId, snapshotId);
      const validation = await runValidation(projectId, ["npx tsc --noEmit"]);
      updateProject(projectId, (prev) => ({
        cursor: prev.cursor - 1,
        status: validation.ok
          ? { phase: "ready", message: "Undo complete. Preview is stable." }
          : {
              phase: "ready",
              message: "Undo complete, but validation warnings remain.",
              validationLogs: { stdout: validation.stdout_tail, stderr: validation.stderr_tail },
            },
      }));
    } catch (err) {
      updateProject(projectId, () => ({
        status: {
          phase: "failed",
          error: { title: "Undo failed", detail: err instanceof Error ? err.message : String(err) },
        },
      }));
    }
  }, [projects, updateProject]);

  const redoNext = useCallback(async (projectId: string) => {
    const proj = projects[projectId] ?? INITIAL_PROJECT_STATE;
    if (proj.cursor >= proj.history.length - 1) return;

    const snapshotId = proj.history[proj.cursor + 1];
    updateProject(projectId, () => ({
      status: { phase: "validating", message: "Reapplying checkpoint..." },
    }));

    try {
      await reapplySnapshot(projectId, snapshotId);
      const validation = await runValidation(projectId, ["npx tsc --noEmit"]);
      updateProject(projectId, (prev) => ({
        cursor: prev.cursor + 1,
        status: validation.ok
          ? { phase: "ready", message: "Redo complete. Preview is stable." }
          : {
              phase: "ready",
              message: "Redo complete, but validation warnings remain.",
              validationLogs: { stdout: validation.stdout_tail, stderr: validation.stderr_tail },
            },
      }));
    } catch (err) {
      updateProject(projectId, () => ({
        status: {
          phase: "failed",
          error: { title: "Redo failed", detail: err instanceof Error ? err.message : String(err) },
        },
      }));
    }
  }, [projects, updateProject]);

  // Check disk for existing workspace — restores hasProject + logs after app restart
  const checkedProjects = useRef<Set<string>>(new Set());
  const checkHasProject = useCallback((projectId: string) => {
    if (checkedProjects.current.has(projectId)) return;
    checkedProjects.current.add(projectId);
    const proj = projectsRef.current[projectId];
    if (proj?.hasProject) return; // already known
    checkProjectHasApp(projectId).then(async (exists) => {
      if (exists) {
        // Load saved generation logs from disk
        let logs: string[] = [];
        try { logs = await loadGenerationLogs(projectId); } catch { /* no logs */ }
        updateProject(projectId, () => ({
          hasProject: true,
          status: { phase: "ready", message: "Project restored." },
          ...(logs.length > 0 ? { generationLogs: logs } : {}),
        }));
      }
    }).catch(() => {}); // ignore errors (e.g. invalid ID)
  }, [updateProject]);

  return { getProject, start, cancel, undoLast, redoNext, checkHasProject };
}
