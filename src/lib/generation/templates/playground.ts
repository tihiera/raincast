import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const playground: LayoutTemplate = {
  id: "playground",
  name: "Playground",
  description: "Centered input→fetch→visualize tool — URL analyzer, prompt tuner, API tester, data explorer",
  keywords: [
    "playground", "sandbox", "tester", "analyzer", "explorer",
    "prompt tuner", "prompt editor", "api tester", "url analyzer",
    "link preview", "data explorer", "insight", "inspector",
    "debugger", "viewer", "parser", "formatter", "validator",
    "fetcher", "scraper", "aggregator", "story", "storyteller",
    "voice", "companion", "assistant", "boyfriend", "girlfriend",
    "creator", "generator", "converter", "visualizer", "scanner",
    "checker", "tracker", "wallet", "token", "solscan",
    "lookup", "search tool", "calculator", "translator",
    "summarizer", "previewer", "color picker", "gradient",
  ],
  appShell: `\
import { useState } from "react";
import { Search, ArrowRight, Loader2 } from "lucide-react";
import { useDrag } from "./hooks/useDrag";

export default function App() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const onDrag = useDrag();

  const run = () => {
    if (!input.trim()) return;
    setPhase("loading");
    setTimeout(() => setPhase("done"), 1200);
  };

  return (
    <div className="h-screen overflow-y-auto" style={{ background: "var(--surface-window)" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px 60px" }}>
        {/* Title */}
        <div className="traffic-light-pad" onMouseDown={onDrag} style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" }}>App</h1>
          <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>Description of what this tool does.</p>
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2" style={{ marginBottom: 32 }}>
          <div className="flex-1 flex items-center" style={{
            borderRadius: 10, border: "0.5px solid var(--border-secondary)",
            background: "var(--surface-raised)", padding: "0 14px",
          }}>
            <Search size={14} strokeWidth={1.5} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="Paste a URL or enter a query..."
              style={{
                flex: 1, padding: "11px 10px", border: "none", background: "transparent",
                fontSize: 13, color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
              }}
            />
          </div>
          <button onClick={run} className="flex items-center gap-1.5" style={{
            padding: "10px 18px", borderRadius: 10, border: "none",
            background: "var(--accent)", color: "#fff",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Run <ArrowRight size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Results area */}
        {phase === "loading" && (
          <div className="flex flex-col items-center" style={{ padding: "60px 0" }}>
            <Loader2 size={24} strokeWidth={1.5} style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }} />
            <style>{\`@keyframes spin { to { transform: rotate(360deg); } }\`}</style>
          </div>
        )}
        {phase === "done" && (
          <div className="flex flex-col gap-4">
            {/* Result cards go here — use borderRadius: 12, 0.5px borders, var(--surface-raised) */}
          </div>
        )}
      </div>
    </div>
  );
}
`,
  components: [],
  cssAdditions: "",
  promptContext: `This is a PLAYGROUND / ANALYZER layout. NO title bar — traffic lights float over the content. The app has:
- A centered container (maxWidth: 680) on the window background — NO sidebar
- A title + description at the top (text-align: center), with class "traffic-light-pad" and onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- An input bar: rounded card with Search icon + text input + action button (var(--accent) bg)
- Three phases: idle (hints/examples), loading (spinner), done (results)
- Results displayed as stacked cards (borderRadius: 12, 0.5px borders, var(--surface-raised))

PLAYGROUND PATTERNS:
- Input bar: border: 0.5px solid var(--border-secondary), background: var(--surface-raised), borderRadius: 10
- Action button: var(--accent) background, #fff text, borderRadius: 10
- Loading: centered Loader2 spinner with CSS animation
- Result cards: 12px border-radius, 18-22px padding, 0.5px borders
- Data visualization: use simple div-based bar charts (colored divs with percentage widths), dot legends
- Stacked language/progress bars: flex row, height 6-8px, borderRadius: 4, overflow hidden
- Hint buttons (idle state): small pills with border, borderRadius: 8, hover changes borderColor to var(--accent)
- Two-column layouts for side-by-side data: CSS grid with gap-4
- Code/hash badges: fontSize: 10, monospace font, var(--accent-bg) background, borderRadius: 4

You MUST generate:
- src/App.tsx — the complete playground UI with input handling, loading state, and result visualization
- src/components/*.tsx — visualization components if needed (charts, tables, cards)

Do NOT add a sidebar or navigation. The entire app is one focused, centered screen.
The page itself scrolls (overflow-y-auto on root) — no fixed chrome except the input bar area.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
