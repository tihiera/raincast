/**
 * Desktop app layout templates (archetypes).
 *
 * Each archetype defines a desktop-native layout skeleton: an App.tsx shell,
 * optional component stubs, CSS additions, and prompt context for the AI.
 *
 * The keyword-based `selectLayout()` picks the best archetype from user text.
 * Falls back to "generic" when nothing matches confidently.
 */

export { DESKTOP_NATIVE_CSS, SHARED_LAYOUT_RULES } from "./styles";

// ── Re-export individual templates for direct access ─────────────────

export { dashboard } from "./dashboard";
export { editor } from "./editor";
export { chat } from "./chat";
export { fileManager } from "./fileManager";
export { media } from "./media";
export { dataTable } from "./dataTable";
export { utility } from "./utility";
export { playground } from "./playground";
export { generic } from "./generic";

// ── Types ────────────────────────────────────────────────────────────

export type LayoutArchetype =
  | "dashboard"
  | "editor"
  | "chat"
  | "file-manager"
  | "media"
  | "data-table"
  | "utility"
  | "playground"
  | "generic";

export interface LayoutTemplate {
  id: LayoutArchetype;
  name: string;
  description: string;
  /** Keywords used by selectLayout() to score against user text. */
  keywords: string[];
  /** App.tsx content — the layout skeleton the AI fills in. */
  appShell: string;
  /** Additional component files scaffolded alongside App.tsx. */
  components: Array<{ path: string; content: string }>;
  /** Extra CSS appended to index.css (after the desktop-native base). */
  cssAdditions: string;
  /** Injected into the AI prompt so it understands the layout contract. */
  promptContext: string;
  /** Hard rules the AI must follow for this layout. */
  layoutRules: string;
}

// ── Registry ─────────────────────────────────────────────────────────

import { dashboard } from "./dashboard";
import { editor } from "./editor";
import { chat } from "./chat";
import { fileManager } from "./fileManager";
import { media } from "./media";
import { dataTable } from "./dataTable";
import { utility } from "./utility";
import { playground } from "./playground";
import { generic } from "./generic";

const TEMPLATES: Record<LayoutArchetype, LayoutTemplate> = {
  dashboard,
  editor,
  chat,
  "file-manager": fileManager,
  media,
  "data-table": dataTable,
  utility,
  playground,
  generic,
};

/** Get a layout template by archetype id. */
export function getLayoutTemplate(archetype: LayoutArchetype): LayoutTemplate {
  return TEMPLATES[archetype] ?? TEMPLATES.generic;
}

/** Get all template descriptions (for LLM prompt injection). */
export function getTemplateDescriptions(): string {
  return Object.values(TEMPLATES)
    .filter((t) => t.id !== "generic")
    .map((t) => `- "${t.id}": ${t.description}`)
    .join("\n");
}

// ── Keyword-based layout selector ────────────────────────────────────

/**
 * Score user text against a template's keywords.
 * Returns a score >= 0 (higher = better match).
 */
function scoreTemplate(userText: string, template: LayoutTemplate): number {
  const lower = userText.toLowerCase();
  let score = 0;

  for (const keyword of template.keywords) {
    if (lower.includes(keyword)) {
      // Longer keyword matches are worth more (more specific)
      score += keyword.split(" ").length;
    }
  }

  return score;
}

/**
 * Select the best layout archetype for a user's build request.
 * Uses keyword matching. Returns "generic" if no confident match.
 *
 * @param userText - The user's message describing what they want to build
 * @returns The best-matching LayoutArchetype
 */
export function selectLayout(userText: string): LayoutArchetype {
  let bestId: LayoutArchetype = "generic";
  let bestScore = 0;

  for (const template of Object.values(TEMPLATES)) {
    if (template.id === "generic") continue;
    const score = scoreTemplate(userText, template);
    if (score > bestScore) {
      bestScore = score;
      bestId = template.id;
    }
  }

  // Require at least a score of 1 to override generic
  return bestScore >= 1 ? bestId : "generic";
}
