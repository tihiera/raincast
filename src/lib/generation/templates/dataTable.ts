import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const dataTable: LayoutTemplate = {
  id: "data-table",
  name: "Data Table",
  description: "Table/records view with toolbar, filter tabs, and detail drawer",
  keywords: [
    "table", "data table", "spreadsheet", "grid", "records", "list",
    "inventory", "crm", "database", "contacts", "tasks", "task manager",
    "todo", "to-do", "kanban", "board", "project manager", "tracker",
    "issue tracker", "bug tracker",
  ],
  appShell: `\
import TableToolbar from "./components/TableToolbar";

export default function App() {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--surface-window)" }}>
      <TableToolbar />
      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-5 select-none"
        style={{ height: 40, borderBottom: "0.5px solid var(--border-secondary)" }}>
        {/* Filter buttons go here */}
      </div>
      <main className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        <div style={{
          borderRadius: 10, border: "0.5px solid var(--border-secondary)",
          background: "var(--surface-raised)", overflow: "hidden",
        }}>
          {/* Table header */}
          <div className="grid items-center" style={{
            gridTemplateColumns: "1fr 2fr 1fr 0.7fr 0.7fr",
            padding: "10px 16px", borderBottom: "0.5px solid var(--border-secondary)",
            fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)",
          }}>
            <span>ID</span><span>Name</span><span>Status</span><span>Priority</span><span>Date</span>
          </div>
          {/* Table rows go here */}
        </div>
      </main>
    </div>
  );
}
`,
  components: [
    {
      path: "src/components/TableToolbar.tsx",
      content: `\
import { ClipboardList, Filter, Plus } from "lucide-react";
import { useDrag } from "../hooks/useDrag";

export default function TableToolbar() {
  const onDrag = useDrag();

  return (
    <header className="flex items-center justify-between px-5 shrink-0 select-none" onMouseDown={onDrag}
      style={{ height: 48, borderBottom: "0.5px solid var(--border-secondary)" }}>
      <div className="flex items-center gap-2">
        <ClipboardList size={15} strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Records</h1>
      </div>
      <div className="flex items-center gap-2">
        <button style={{
          display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
          borderRadius: 7, border: "0.5px solid var(--border-secondary)",
          background: "transparent", cursor: "pointer",
          fontSize: 12, color: "var(--text-secondary)",
        }}>
          <Filter size={12} strokeWidth={1.5} /> Filter
        </button>
        <button style={{
          display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
          borderRadius: 7, border: "none",
          background: "var(--accent)", color: "#fff",
          fontSize: 12, fontWeight: 500, cursor: "pointer",
        }}>
          <Plus size={13} strokeWidth={2} /> New
        </button>
      </div>
    </header>
  );
}
`,
    },
  ],
  cssAdditions: "",
  promptContext: `This is a DATA TABLE / CRUD layout (no sidebar). NO title bar — traffic lights float over the content. The app has:
- A top header (48px) with title icon, title, filter button, and "New" action button, with onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- A filter tab row (40px) with selectable status filters styled as buttons (borderRadius: 6, fontSize: 12)
- A scrollable table in a rounded card (borderRadius: 10, var(--surface-raised))

TABLE PATTERNS:
- Table uses CSS grid (not <table>): gridTemplateColumns, consistent padding "10px 16px" or "11px 16px"
- Header row: fontSize: 12, fontWeight: 500, color: var(--text-tertiary), 0.5px bottom border
- Data rows: fontSize: 13, 0.5px border separators, hover with var(--hover-bg) via onMouseEnter/Leave
- Status badges: fontSize: 11, padding: "2px 8px", borderRadius: 5, semi-transparent bg (rgba), solid text color
- Priority badges: same pattern with color coding (high=#FF3B30, medium=#FF9F0A, low=var(--text-tertiary))

You MUST generate:
- src/App.tsx — wire up data, filters, row hover
- src/components/TableToolbar.tsx — header with actions
- src/components/*.tsx — status/priority badge components, detail drawer

The toolbar and filter tabs are FIXED. The table scrolls within the rounded card.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
