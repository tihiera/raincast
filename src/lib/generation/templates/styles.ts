/** Desktop-native shared CSS and layout rules. */

export const DESKTOP_NATIVE_CSS = `\
/* ── macOS Native Design Tokens ── */
:root {
  --surface-window: #f0f0f0;
  --surface-primary: rgba(246, 246, 246, 0.92);
  --surface-secondary: rgba(255, 255, 255, 0.85);
  --surface-sidebar: rgba(240, 240, 240, 0.95);
  --surface-inset: rgba(0, 0, 0, 0.03);
  --surface-raised: rgba(255, 255, 255, 0.95);

  --text-primary: rgba(0, 0, 0, 0.85);
  --text-secondary: rgba(0, 0, 0, 0.50);
  --text-tertiary: rgba(0, 0, 0, 0.30);

  --border-primary: rgba(0, 0, 0, 0.09);
  --border-secondary: rgba(0, 0, 0, 0.06);

  --accent: #007AFF;
  --accent-bg: rgba(0, 122, 255, 0.10);
  --accent-hover: rgba(0, 122, 255, 0.06);

  --hover-bg: rgba(0, 0, 0, 0.04);
  --active-bg: rgba(0, 0, 0, 0.07);
  --selected-bg: rgba(0, 122, 255, 0.12);
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-window: #141414;
    --surface-primary: rgba(20, 20, 20, 0.92);
    --surface-secondary: rgba(28, 28, 28, 0.85);
    --surface-sidebar: rgba(24, 24, 24, 0.82);
    --surface-inset: rgba(255, 255, 255, 0.04);
    --surface-raised: rgba(30, 30, 30, 0.90);

    --text-primary: rgba(255, 255, 255, 0.88);
    --text-secondary: rgba(255, 255, 255, 0.55);
    --text-tertiary: rgba(255, 255, 255, 0.30);

    --border-primary: rgba(255, 255, 255, 0.10);
    --border-secondary: rgba(255, 255, 255, 0.06);

    --accent: #0A84FF;
    --accent-bg: rgba(10, 132, 255, 0.15);
    --accent-hover: rgba(10, 132, 255, 0.08);

    --hover-bg: rgba(255, 255, 255, 0.06);
    --active-bg: rgba(255, 255, 255, 0.09);
    --selected-bg: rgba(10, 132, 255, 0.18);
  }
}

/* ── Desktop-native base ── */
html, body, #root {
  height: 100%;
  overflow: hidden;
  margin: 0;
}

body {
  color: var(--text-primary);
  background: var(--surface-window);
}

/* Thin scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.22); }
@media (prefers-color-scheme: dark) {
  ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.22); }
}

.hide-scrollbar::-webkit-scrollbar { display: none; }
.hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

.select-none { user-select: none; }

::selection { background: var(--accent-bg); }

/* ── Window chrome: traffic light safe area ── */
/* macOS overlay titlebar — traffic lights float over content.
   Sidebar top and header areas need padding to avoid overlap. */
.traffic-light-pad { padding-top: 32px; }
`;

export const SHARED_LAYOUT_RULES = `\
DESKTOP-NATIVE LAYOUT RULES (CRITICAL — follow these for ALL generated code):
- The root element MUST be h-screen and overflow-hidden. The app fills the window.
- NEVER add page-level scrolling. Content scrolls INSIDE panels (overflow-y-auto on inner containers).
- Sidebars, toolbars, headers, footers, and transport bars are FIXED chrome — they never scroll away.
- Navigation swaps panel CONTENT, not entire pages. No full-page route transitions.

WINDOW CHROME (macOS overlay titlebar — NO title bar, traffic lights float over content):
- The window has NO visible title bar. The macOS traffic lights (close/minimize/maximize) float in the top-left.
- The sidebar's first child must be a spacer: <div className="shrink-0 traffic-light-pad" /> (adds top padding to clear the traffic lights).

WINDOW DRAGGING (CRITICAL — do NOT use CSS -webkit-app-region: drag):
- Import { useDrag } from "./hooks/useDrag" in src/ files (e.g. App.tsx), or from "../hooks/useDrag" in src/components/ files — it returns an onMouseDown handler that calls Tauri's startDragging() API.
- Attach onMouseDown={onDrag} to draggable areas: the sidebar <aside>, headers, toolbars.
- Add the data-no-drag attribute to ALL interactive elements inside draggable areas (buttons, inputs, links) so they remain clickable.
- Do NOT use CSS classes "drag-region" or "no-drag" — they don't work in Tauri 2. Use useDrag() + data-no-drag attribute instead.
- Double-click on a draggable area toggles maximize.
- Example: const onDrag = useDrag(); <aside onMouseDown={onDrag}><button data-no-drag>Click</button></aside>
- This creates the Apple Music / Finder look: content extends edge-to-edge, traffic lights overlay the sidebar.

NATIVE macOS STYLING (CRITICAL — all generated UI must follow these):
- Use CSS custom properties for ALL colors: var(--surface-window), var(--text-primary), var(--accent), etc.
- Surface tokens: --surface-window (page bg), --surface-sidebar (sidebar bg), --surface-raised (cards/panels), --surface-inset (input bg).
- Text hierarchy: --text-primary (headings/body), --text-secondary (labels), --text-tertiary (hints/captions).
- Borders: ALWAYS 0.5px solid var(--border-secondary) via inline style={{ border: "0.5px solid var(--border-secondary)" }}.
- Accent: var(--accent) for primary buttons/links, var(--accent-bg) for selected row/item backgrounds.
- Hover: Use onMouseEnter/onMouseLeave setting style.background = "var(--hover-bg)".
- Sidebars: Rounded card pattern — outer wrapper padding: "6px 0 6px 6px", inner aside borderRadius: 12, backdrop-filter: blur(20px) saturate(1.4), background: var(--surface-sidebar).
- Cards/panels: borderRadius: 10, 0.5px border, background: var(--surface-raised).
- Use INLINE STYLES (style={{...}}) for colors, borders, border-radius, padding. Use Tailwind ONLY for layout (flex, h-full, overflow-hidden, items-center, gap-*).
- Icons: ALWAYS use lucide-react. Import specific icons. Size 13-16, strokeWidth 1.4-1.6.
- Font sizes: 11px labels, 12px secondary, 13px body, 15px titles. fontWeight 500-600.
- Inputs: NEVER type="number". Use type="text" with inputMode="decimal".
- Do NOT use Tailwind color classes (bg-gray-*, text-gray-*). ONLY CSS custom properties.
- Do NOT use shadows for separation — use 0.5px borders and subtle backgrounds.
- Light/dark mode adapts automatically via CSS custom properties.

EXPORTS & TYPES (CRITICAL — the #1 cause of build failures):
- EVERY type, interface, constant, enum, and function that ANY other file imports MUST have the \`export\` keyword on its declaration.
- If you write a types.ts, EVERY SINGLE declaration MUST be exported. No exceptions. Example: \`export interface Foo {}\`, \`export type Bar = ...\`, \`export const MY_CONST = ...\`.
- If you write a hook (useXxx.ts), it MUST be: \`export function useXxx()\` or \`export default function useXxx()\`.
- If you write a component, it MUST be: \`export default function ComponentName()\`.
- Give explicit TypeScript types to ALL function parameters. Never leave parameters as implicit \`any\`.
- Before finishing EACH file, audit: "does another file import something from here?" If yes, verify every imported name is exported.`;
