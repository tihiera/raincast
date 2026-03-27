import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const editor: LayoutTemplate = {
  id: "editor",
  name: "Editor",
  description: "Document, code, or canvas editor with toolbar and optional side panel",
  keywords: [
    "editor", "ide", "code editor", "text editor", "markdown", "notes",
    "note taking", "notebook", "document", "writing", "canvas", "diagram",
    "drawing", "design", "whiteboard", "spreadsheet", "rich text",
  ],
  appShell: `\
import Toolbar from "./components/Toolbar";
import { useDrag } from "./hooks/useDrag";

export default function App() {
  const onDrag = useDrag();

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--surface-window)" }}>
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* Optional file tree sidebar */}
        <div className="shrink-0 select-none" style={{ width: 200, padding: "6px 0 6px 6px" }}>
          <aside className="flex flex-col h-full" onMouseDown={onDrag} style={{
            background: "var(--surface-sidebar)",
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            borderRadius: 12,
            border: "0.5px solid var(--border-secondary)",
            overflow: "hidden",
          }}>
            <div className="shrink-0 traffic-light-pad" />
            <nav className="flex-1 overflow-y-auto px-2.5">
              {/* File tree items */}
            </nav>
          </aside>
        </div>
        <main className="flex-1 overflow-y-auto" style={{ padding: 24 }}>
          {/* Editor canvas / content area */}
        </main>
      </div>
    </div>
  );
}
`,
  components: [
    {
      path: "src/components/Toolbar.tsx",
      content: `\
import { Save, Undo2, Redo2 } from "lucide-react";
import { useDrag } from "../hooks/useDrag";

export default function Toolbar() {
  const onDrag = useDrag();

  return (
    <div className="flex items-center gap-1 px-3 shrink-0 select-none" onMouseDown={onDrag}
      style={{ height: 40, borderBottom: "0.5px solid var(--border-secondary)" }}>
      {[
        { label: "Save", Icon: Save },
        { label: "Undo", Icon: Undo2 },
        { label: "Redo", Icon: Redo2 },
      ].map((btn) => (
        <button key={btn.label} title={btn.label} data-no-drag style={{
          width: 28, height: 28, borderRadius: 6, border: "none",
          background: "transparent", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-secondary)", transition: "all 0.12s",
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <btn.Icon size={14} strokeWidth={1.5} />
        </button>
      ))}
      <div className="flex-1" />
    </div>
  );
}
`,
    },
  ],
  cssAdditions: "",
  promptContext: `This is an EDITOR layout. NO title bar — traffic lights float over the sidebar. The app has:
- A compact toolbar strip (40px) with icon buttons for actions (save, undo, redo, formatting), with onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- A rounded sidebar card (borderRadius: 12, backdrop-filter blur) for file tree or outline, ~200px wide. The sidebar <aside> MUST have onMouseDown={onDrag} using useDrag() hook so the entire sidebar is draggable. Its first child is a spacer with class "traffic-light-pad". All buttons/inputs inside MUST have data-no-drag attribute.
- A full-bleed editor/canvas area that fills available space

You MUST generate:
- src/App.tsx — set up the editor content area (text area, canvas, etc.)
- src/components/Toolbar.tsx — add toolbar actions with lucide-react icons
- src/components/*.tsx — editor-specific components (file tree items, formatting controls)

The toolbar is FIXED. The editor area scrolls independently.
Use var(--surface-inset) for editor input backgrounds, 0.5px borders for separators.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
