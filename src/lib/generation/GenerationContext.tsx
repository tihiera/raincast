import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useGeneration } from "./useGeneration";
import { type GenerationStatus, INITIAL_STATUS } from "./types";
import type { ChatMessage } from "../chat/types";
import type { LayoutArchetype } from "./templates";
import type { ScaffoldTier } from "./scaffolds";
import { useProjectContext } from "../project/ProjectContext";

interface GenerationCtx {
  /** State for the currently active project */
  status: GenerationStatus;
  isRunning: boolean;
  undoStack: string[];
  redoStack: string[];
  hasProject: boolean;
  generationLogs: string[];
  /** Active project ID (for convenience) */
  activeProjectId: string;
  /** Ref that PreviewPane populates with a function returning current runtime errors. */
  runtimeErrorsRef: React.MutableRefObject<(() => string[]) | null>;
  start: (projectId: string, messages: ChatMessage[], mode: "build" | "edit", reason?: string, onFirstCheckpoint?: () => void, onChatStatus?: (msg: ChatMessage) => void, onChatStatusAppend?: (id: string, textChunk: string) => void, layoutArchetype?: LayoutArchetype, onToolStatus?: (status: { text: string; tool?: string; args?: string } | null) => void, onProjectRenamed?: (newName: string) => void, scaffoldTier?: ScaffoldTier) => void;
  cancel: (projectId: string) => void;
  undoLast: (projectId: string) => Promise<void>;
  redoNext: (projectId: string) => Promise<void>;
}

// Stable ref placeholder for the default context (never actually used)
const _nullRef = { current: null };

const GenerationContext = createContext<GenerationCtx>({
  status: INITIAL_STATUS,
  isRunning: false,
  undoStack: [],
  redoStack: [],
  hasProject: false,
  generationLogs: [],
  activeProjectId: "",
  runtimeErrorsRef: _nullRef,
  start: () => {},
  cancel: () => {},
  undoLast: async () => {},
  redoNext: async () => {},
});

export function GenerationProvider({ children }: { children: ReactNode }) {
  const { activeId } = useProjectContext();
  const runtimeErrorsRef = useRef<(() => string[]) | null>(null);
  const gen = useGeneration(runtimeErrorsRef);
  const project = gen.getProject(activeId);

  // Restore hasProject from disk when switching to a project
  useEffect(() => {
    if (activeId) gen.checkHasProject(activeId);
  }, [activeId, gen.checkHasProject]);

  const value = useMemo<GenerationCtx>(() => ({
    status: project.status,
    isRunning: project.isRunning,
    undoStack: project.history.slice(0, project.cursor + 1),
    redoStack: project.history.slice(project.cursor + 1),
    hasProject: project.hasProject,
    generationLogs: project.generationLogs,
    activeProjectId: activeId,
    runtimeErrorsRef,
    start: gen.start,
    cancel: gen.cancel,
    undoLast: gen.undoLast,
    redoNext: gen.redoNext,
  }), [project, activeId, gen.start, gen.cancel, gen.undoLast, gen.redoNext]);

  return (
    <GenerationContext.Provider value={value}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGenerationContext() {
  return useContext(GenerationContext);
}
