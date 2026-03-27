import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { ChatMessage } from "../chat/types";
import {
  dbLoadAll,
  dbCreateProject,
  dbRenameProject,
  dbSetProjectOpen,
  dbDeleteProject,
  dbSaveMessages,
  dbSetSetting,
} from "../tauri/db";
import { loadAppIcon } from "../tauri/workspace";

export interface Project {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  /** Whether this project is visible as a tab */
  open: boolean;
  /** App icon as a data URL (loaded from disk). */
  icon?: string;
}

interface ProjectCtx {
  /** All projects (including closed/hidden ones) */
  allProjects: Project[];
  /** Only projects visible as tabs */
  openProjects: Project[];
  activeId: string;
  active: Project;
  loaded: boolean;
  createProject: () => Promise<string>;
  switchProject: (id: string) => void;
  /** Hide from tab bar — project persists in history */
  closeProject: (id: string) => void;
  /** Permanently delete a project */
  deleteProject: (id: string) => void;
  /** Re-open a closed project as a tab */
  reopenProject: (id: string) => void;
  renameProject: (id: string, title: string) => void;
  setProjectIcon: (id: string, iconDataUrl: string) => void;
  updateMessages: (id: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
}

const EMPTY_PROJECT: Project = { id: "", title: "App #1", messages: [], createdAt: 0, open: true };

const ProjectContext = createContext<ProjectCtx>({
  allProjects: [],
  openProjects: [],
  activeId: "",
  active: EMPTY_PROJECT,
  loaded: false,
  createProject: async () => "",
  switchProject: () => {},
  closeProject: () => {},
  deleteProject: () => {},
  reopenProject: () => {},
  renameProject: () => {},
  setProjectIcon: () => {},
  updateMessages: () => {},
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Debounced message save
  const dirtyProjects = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const flushDirty = useCallback(() => {
    const dirty = dirtyProjects.current;
    if (dirty.size === 0) return;
    const toSave = new Set(dirty);
    dirty.clear();
    for (const id of toSave) {
      const proj = projectsRef.current.find((p) => p.id === id);
      if (proj) {
        dbSaveMessages(id, proj.messages).catch((e) =>
          console.error("[ProjectCtx] save messages failed:", e),
        );
      }
    }
  }, []);

  const scheduleSave = useCallback((id: string) => {
    dirtyProjects.current.add(id);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushDirty, 500);
  }, [flushDirty]);

  // Flush on unmount
  useEffect(() => () => flushDirty(), [flushDirty]);

  // ── Load from DB on mount ──────────────────────────────────────────

  useEffect(() => {
    dbLoadAll().then(async (result) => {
      let loadedProjects: Project[] = result.projects.map((p) => ({
        id: p.id,
        title: p.title,
        messages: p.messages,
        createdAt: p.createdAt,
        open: p.isOpen,
      }));

      // If no projects, create a default one
      if (loadedProjects.length === 0) {
        const id = await dbCreateProject("App #1");
        loadedProjects = [{ id, title: "App #1", messages: [], createdAt: Date.now(), open: true }];
      }

      setProjects(loadedProjects);

      // Restore active project
      const openOnes = loadedProjects.filter((p) => p.open);
      const restoredId = result.activeProjectId && loadedProjects.some((p) => p.id === result.activeProjectId)
        ? result.activeProjectId
        : openOnes[0]?.id ?? loadedProjects[0]?.id ?? "";
      setActiveId(restoredId);
      setLoaded(true);
    }).catch((e) => {
      console.error("[ProjectCtx] Failed to load from DB:", e);
      // Fallback: create in-memory project (DB may not be available during dev)
      const fallbackId = crypto.randomUUID();
      setProjects([{ id: fallbackId, title: "App #1", messages: [], createdAt: Date.now(), open: true }]);
      setActiveId(fallbackId);
      setLoaded(true);
    });
  }, []);

  // ── Load app icons from disk ──────────────────────────────────────

  const iconsLoadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!loaded) return;
    for (const p of projects) {
      if (p.icon || iconsLoadedRef.current.has(p.id)) continue;
      iconsLoadedRef.current.add(p.id);
      loadAppIcon(p.id).then((dataUrl) => {
        if (dataUrl) {
          setProjects((prev) =>
            prev.map((proj) => (proj.id === p.id ? { ...proj, icon: dataUrl } : proj)),
          );
        }
      }).catch(() => {});
    }
  }, [loaded, projects]);

  // ── Persist active project ID ──────────────────────────────────────

  const prevActiveId = useRef(activeId);
  useEffect(() => {
    if (activeId && activeId !== prevActiveId.current) {
      prevActiveId.current = activeId;
      dbSetSetting("active_project_id", activeId).catch(() => {});
    }
  }, [activeId]);

  // ── Derived state ──────────────────────────────────────────────────

  const openProjects = projects.filter((p) => p.open);
  const active = openProjects.find((p) => p.id === activeId) ?? openProjects[0] ?? EMPTY_PROJECT;

  // ── Actions ────────────────────────────────────────────────────────

  const createProject = useCallback(async () => {
    const nextNum = projectsRef.current.length + 1;
    const title = `App #${nextNum}`;
    const id = await dbCreateProject(title);
    const project: Project = { id, title, messages: [], createdAt: Date.now(), open: true };
    setProjects((prev) => [...prev, project]);
    setActiveId(id);
    return id;
  }, []);

  const switchProject = useCallback((id: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, open: true } : p)),
    );
    setActiveId(id);
    dbSetProjectOpen(id, true).catch(() => {});
  }, []);

  const closeProject = useCallback((id: string) => {
    setProjects((prev) => {
      const openOnes = prev.filter((p) => p.open);
      if (openOnes.length <= 1 && openOnes[0]?.id === id) return prev;
      return prev.map((p) => (p.id === id ? { ...p, open: false } : p));
    });
    setActiveId((prevActive) => {
      if (prevActive !== id) return prevActive;
      const remaining = projectsRef.current.filter((p) => p.open && p.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : prevActive;
    });
    dbSetProjectOpen(id, false).catch(() => {});
  }, []);

  const deleteProject = useCallback((id: string) => {
    if (!id) return;

    // Remove from dirty set so flushDirty doesn't try to save it
    dirtyProjects.current.delete(id);

    // Remove from DB (cascade deletes messages + images)
    dbDeleteProject(id).catch(() => {});

    setProjects((prev) => prev.filter((p) => p.id !== id));

    // If we deleted the active project, create a fresh one (like "New Project")
    setActiveId((prevActive) => {
      if (prevActive !== id) return prevActive;
      const remaining = projectsRef.current.filter((p) => p.id !== id);
      const nextNum = remaining.length + 1;
      const freshTitle = `App #${nextNum}`;
      dbCreateProject(freshTitle).then((freshId) => {
        setProjects((cur) => [
          ...cur,
          { id: freshId, title: freshTitle, messages: [], createdAt: Date.now(), open: true },
        ]);
        setActiveId(freshId);
      });
      return prevActive;
    });
  }, []);

  const reopenProject = useCallback((id: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, open: true } : p)),
    );
    setActiveId(id);
    dbSetProjectOpen(id, true).catch(() => {});
  }, []);

  const renameProject = useCallback((id: string, title: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, title } : p)),
    );
    dbRenameProject(id, title).catch(() => {});
  }, []);

  const setProjectIcon = useCallback((id: string, iconDataUrl: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, icon: iconDataUrl } : p)),
    );
  }, []);

  const updateMessages = useCallback((id: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = typeof messages === "function" ? messages(p.messages) : messages;
        return { ...p, messages: next };
      }),
    );
    scheduleSave(id);
  }, [scheduleSave]);

  return (
    <ProjectContext.Provider
      value={{
        allProjects: projects,
        openProjects,
        activeId,
        active,
        loaded,
        createProject,
        switchProject,
        closeProject,
        deleteProject,
        reopenProject,
        renameProject,
        setProjectIcon,
        updateMessages,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  return useContext(ProjectContext);
}
