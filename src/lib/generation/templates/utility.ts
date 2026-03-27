import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const utility: LayoutTemplate = {
  id: "utility",
  name: "Utility",
  description: "Compact single-purpose tool — calculator, converter, timer, picker",
  keywords: [
    "calculator", "converter", "unit converter", "timer", "stopwatch",
    "clock", "color picker", "picker", "generator", "password generator",
    "qr code", "barcode", "weather widget", "widget", "clipboard",
    "pomodoro", "counter", "dice", "random",
  ],
  appShell: `\
import { useDrag } from "./hooks/useDrag";

export default function App() {
  const onDrag = useDrag();

  return (
    <div className="flex flex-col h-screen overflow-hidden items-center justify-center"
      style={{ background: "var(--surface-window)" }}>
      <div style={{ width: 380, padding: 24 }} className="traffic-light-pad" onMouseDown={onDrag}>
        <h1 data-no-drag style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 20px" }}>App</h1>
        <div style={{
          borderRadius: 12, border: "0.5px solid var(--border-secondary)",
          background: "var(--surface-raised)", padding: 20,
        }}>
          {/* Tool UI goes here */}
        </div>
      </div>
    </div>
  );
}
`,
  components: [],
  cssAdditions: "",
  promptContext: `This is a UTILITY / SINGLE-PURPOSE TOOL layout. NO title bar — traffic lights float over the content. The app has:
- A centered card (width: 380) on the window background, with class "traffic-light-pad" and onMouseDown={onDrag} using useDrag() hook on the container so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- Everything visible at once — no sidebar, no navigation, no scrolling
- Compact, focused UI — one screen, one job

UTILITY PATTERNS:
- Main card: borderRadius: 12, 0.5px border, var(--surface-raised) background, padding: 20
- Segmented controls: flex row of buttons, borderRadius: 7, active gets var(--accent) bg + #fff text
- Input fields: type="text" with inputMode="decimal" (never type="number"), custom stepper buttons (ChevronUp/ChevronDown in a small rounded pill)
- Result display: var(--accent-bg) background, var(--accent) text, borderRadius: 8
- History/log: borderRadius: 10 card with 0.5px border row separators

You MUST generate:
- src/App.tsx — the complete tool UI inside the centered card
- src/components/*.tsx — sub-components if needed

Do NOT add a sidebar or navigation. The entire app is one focused screen.
Keep the UI compact and self-contained.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
