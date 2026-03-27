import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const generic: LayoutTemplate = {
  id: "generic",
  name: "Generic Desktop",
  description: "Fallback desktop layout with rounded sidebar and main content area",
  keywords: [],
  appShell: `\
import { useState } from "react";
import Sidebar from "./components/Sidebar";

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--surface-window)" }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
        {/* Main content area */}
      </main>
    </div>
  );
}
`,
  components: [
    {
      path: "src/components/Sidebar.tsx",
      content: `\
import { useState } from "react";
import { useDrag } from "../hooks/useDrag";

const navItems = [
  { id: "home", label: "Home" },
];

export default function Sidebar() {
  const [active, setActive] = useState("home");
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
  ],
  cssAdditions: "",
  promptContext: `This is a GENERIC DESKTOP layout. NO title bar — traffic lights float over the sidebar. The app has:
- A rounded sidebar card (borderRadius: 12, backdrop-filter blur, var(--surface-sidebar)) with nav items, 220px wide. The sidebar <aside> MUST have onMouseDown={onDrag} using useDrag() hook so the entire sidebar is draggable. Its first child is a spacer with class "traffic-light-pad". All buttons/inputs inside MUST have data-no-drag attribute.
- A scrollable main content area

You MUST generate:
- src/App.tsx — set up the main content. The main area's top bar / header MUST have onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- src/components/Sidebar.tsx — add nav items with lucide-react icons relevant to the app
- src/components/*.tsx — any components the app needs

The sidebar is FIXED. Only the main area scrolls.
Adapt this layout to the user's specific needs.
Use the rounded sidebar card pattern with vibrancy/blur and 0.5px borders throughout.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
