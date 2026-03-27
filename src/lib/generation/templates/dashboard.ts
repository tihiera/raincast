import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const dashboard: LayoutTemplate = {
  id: "dashboard",
  name: "Dashboard",
  description: "Analytics, monitoring, admin panel with rounded sidebar and card grid",
  keywords: [
    "dashboard", "analytics", "monitoring", "admin", "panel", "metrics",
    "stats", "statistics", "overview", "chart", "graph", "widget", "kpi",
    "report", "home automation", "control panel", "system monitor",
  ],
  appShell: `\
import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--surface-window)" }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {/* Dashboard cards go here — use style={{ borderRadius: 10, border: "0.5px solid var(--border-secondary)", background: "var(--surface-raised)", padding: "16px 18px" }} */}
          </div>
        </main>
      </div>
    </div>
  );
}
`,
  components: [
    {
      path: "src/components/Sidebar.tsx",
      content: `\
import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import { useDrag } from "../hooks/useDrag";

const navItems = [
  { id: "overview", label: "Overview", Icon: LayoutGrid },
];

export default function Sidebar() {
  const [active, setActive] = useState("overview");
  const onDrag = useDrag();

  return (
    <div className="shrink-0 select-none" style={{ width: 220, padding: "6px 0 6px 6px" }}>
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
          {navItems.map((item) => {
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
      path: "src/components/Header.tsx",
      content: `\
import { Search } from "lucide-react";
import { useDrag } from "../hooks/useDrag";

export default function Header() {
  const onDrag = useDrag();

  return (
    <header className="flex items-center justify-between px-5 shrink-0 select-none" onMouseDown={onDrag}
      style={{ height: 48, borderBottom: "0.5px solid var(--border-secondary)" }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Overview</h1>
      <div className="flex items-center gap-2">
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
          borderRadius: 7, background: "var(--surface-inset)",
          border: "0.5px solid var(--border-secondary)",
          fontSize: 12, color: "var(--text-tertiary)", minWidth: 160,
        }}>
          <Search size={12} strokeWidth={1.5} /> Search...
        </div>
      </div>
    </header>
  );
}
`,
    },
  ],
  cssAdditions: "",
  promptContext: `This is a DASHBOARD layout. NO title bar — traffic lights float over the sidebar. The app has:
- A rounded sidebar card (borderRadius: 12, backdrop-filter blur) with icon+label nav items, 220px wide. The sidebar <aside> MUST have onMouseDown={onDrag} using useDrag() hook so the entire sidebar is draggable. Its first child is a spacer with class "traffic-light-pad". All buttons/inputs inside MUST have data-no-drag attribute.
- A top header bar (48px) with title and search, with onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- A scrollable main area with a responsive card grid

You MUST generate:
- src/App.tsx — fill in dashboard cards using borderRadius: 10, 0.5px borders, var(--surface-raised) background
- src/components/Sidebar.tsx — add nav items with lucide-react icons for the domain
- src/components/Header.tsx — customize title and action buttons
- src/components/*.tsx — cards, charts, tables, status badges

The sidebar and header are FIXED chrome. Only the <main> area scrolls.
Use status badges with semi-transparent colored backgrounds: rgba(R,G,B, 0.10) bg, solid color text.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
