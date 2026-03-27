import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ImageAttachment } from "../chat/types";

// ── Raw DB types (from Rust serde) ───────────────────────────────────

interface DbImage {
  mime: string;
  base64: string;
  canvas_data: string | null;
}

interface DbMessage {
  id: string;
  role: string;
  content: string;
  status_data: string | null;
  images: DbImage[];
}

interface DbProject {
  id: string;
  title: string;
  created_at: number;
  is_open: boolean;
  messages: DbMessage[];
}

interface DbLoadResult {
  projects: DbProject[];
  active_project_id: string | null;
  active_provider: string | null;
}

// ── Converters ───────────────────────────────────────────────────────

function toImageAttachment(img: DbImage): ImageAttachment {
  return {
    mime: img.mime,
    base64: img.base64,
    dataUrl: `data:${img.mime};base64,${img.base64}`,
    ...(img.canvas_data ? { canvasData: img.canvas_data } : {}),
  };
}

function toChatMessage(msg: DbMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role as ChatMessage["role"],
    content: msg.content,
    ...(msg.images.length > 0 ? { images: msg.images.map(toImageAttachment) } : {}),
    ...(msg.status_data ? { statusData: JSON.parse(msg.status_data) } : {}),
  };
}

function toDbMessage(msg: ChatMessage): DbMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    status_data: msg.statusData ? JSON.stringify(msg.statusData) : null,
    images: (msg.images ?? []).map((img) => ({
      mime: img.mime,
      base64: img.base64,
      canvas_data: img.canvasData ?? null,
    })),
  };
}

// ── Public types ─────────────────────────────────────────────────────

export interface LoadedProject {
  id: string;
  title: string;
  createdAt: number;
  isOpen: boolean;
  messages: ChatMessage[];
}

export interface LoadResult {
  projects: LoadedProject[];
  activeProjectId: string | null;
  activeProvider: string | null;
}

// ── API ──────────────────────────────────────────────────────────────

export async function dbLoadAll(): Promise<LoadResult> {
  const raw = await invoke<DbLoadResult>("db_load_all");
  return {
    projects: raw.projects.map((p) => ({
      id: p.id,
      title: p.title,
      createdAt: p.created_at,
      isOpen: p.is_open,
      messages: p.messages.map(toChatMessage),
    })),
    activeProjectId: raw.active_project_id,
    activeProvider: raw.active_provider,
  };
}

export async function dbCreateProject(title = "App #1"): Promise<string> {
  return invoke<string>("db_create_project", { title });
}

export async function dbRenameProject(id: string, title: string): Promise<void> {
  return invoke<void>("db_rename_project", { id, title });
}

export async function dbSetProjectOpen(id: string, isOpen: boolean): Promise<void> {
  return invoke<void>("db_set_project_open", { id, isOpen });
}

export async function dbDeleteProject(id: string): Promise<void> {
  return invoke<void>("db_delete_project", { id });
}

export async function dbSaveMessages(projectId: string, messages: ChatMessage[]): Promise<void> {
  return invoke<void>("db_save_messages", {
    projectId,
    messages: messages.map(toDbMessage),
  });
}

export async function dbSetSetting(key: string, value: string): Promise<void> {
  return invoke<void>("db_set_setting", { key, value });
}
