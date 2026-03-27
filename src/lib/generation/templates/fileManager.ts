import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const fileManager: LayoutTemplate = {
  id: "file-manager",
  name: "File Manager",
  description: "File browser with rounded sidebar, breadcrumb, and content grid/list",
  keywords: [
    "file manager", "file browser", "explorer", "finder", "files",
    "asset manager", "photo library", "image gallery", "gallery",
    "bookmark manager", "library", "browser", "catalog", "archive",
    "media library", "collection",
  ],
  appShell: `\
import TreeSidebar from "./components/TreeSidebar";
import Breadcrumb from "./components/Breadcrumb";
import { useDrag } from "./hooks/useDrag";

export default function App() {
  const onDrag = useDrag();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--surface-window)" }}>
      <TreeSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 shrink-0 select-none" onMouseDown={onDrag}
          style={{ height: 48, borderBottom: "0.5px solid var(--border-secondary)" }}>
          <Breadcrumb />
          <div className="flex items-center gap-2">
            {/* View toggle (grid/list), sort */}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
          <div style={{
            borderRadius: 10, border: "0.5px solid var(--border-secondary)",
            background: "var(--surface-raised)", overflow: "hidden",
          }}>
            {/* File list rows or grid */}
          </div>
        </main>
      </div>
    </div>
  );
}
`,
  components: [
    {
      path: "src/components/TreeSidebar.tsx",
      content: `\
import { useState } from "react";
import { Folder, FileText, Star, Trash2 } from "lucide-react";
import { useDrag } from "../hooks/useDrag";

const NAV = [
  { id: "all", label: "All Files", Icon: Folder },
  { id: "recent", label: "Recent", Icon: FileText },
  { id: "starred", label: "Starred", Icon: Star },
  { id: "trash", label: "Trash", Icon: Trash2 },
];

export default function TreeSidebar() {
  const [active, setActive] = useState("all");
  const onDrag = useDrag();

  return (
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
          {NAV.map((item) => {
            const isActive = active === item.id;
            return (
              <button key={item.id} onClick={() => setActive(item.id)}
                className="w-full flex items-center text-left" data-no-drag
                style={{
                  padding: "6px 10px", marginBottom: 1, fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  background: isActive ? "var(--hover-bg)" : "transparent",
                  border: "none", cursor: "pointer", borderRadius: 8, gap: 8,
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--hover-bg)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <item.Icon size={15} strokeWidth={1.6} style={{ flexShrink: 0, opacity: isActive ? 0.9 : 0.45 }} />
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
`,
    },
    {
      path: "src/components/Breadcrumb.tsx",
      content: `\
import { ChevronRight } from "lucide-react";

export default function Breadcrumb() {
  return (
    <div className="flex items-center gap-1.5" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>All Files</span>
      <ChevronRight size={12} style={{ opacity: 0.4 }} />
      <span>Documents</span>
    </div>
  );
}
`,
    },
  ],
  cssAdditions: "",
  promptContext: `This is a FILE MANAGER / BROWSER layout. NO title bar — traffic lights float over the sidebar. The app has:
- A rounded sidebar card (borderRadius: 12, backdrop-filter blur) with nav items + storage sections, ~200px wide. The sidebar <aside> MUST have onMouseDown={onDrag} using useDrag() hook so the entire sidebar is draggable. Its first child is a spacer with class "traffic-light-pad". All buttons/inputs inside MUST have data-no-drag attribute.
- A breadcrumb bar + toolbar row (48px) with path and view toggle (grid/list), with onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- A scrollable content area with file rows in a rounded card (borderRadius: 10, var(--surface-raised))

You MUST generate:
- src/App.tsx — wire up navigation state (current path, view mode)
- src/components/TreeSidebar.tsx — folder/category tree with lucide-react icons
- src/components/Breadcrumb.tsx — path breadcrumb trail with ChevronRight separators
- src/components/*.tsx — file rows with type-colored icons (Folder=#FF9F0A, FileText, Image, Film, Music)

File rows: grid layout, 0.5px border separators, hover with var(--hover-bg), fontSize: 13.
The sidebar and breadcrumb bar are FIXED. Only the file area scrolls.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
