import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const media: LayoutTemplate = {
  id: "media",
  name: "Media Player",
  description: "Audio/video player with transparent sidebar overlay, horizontal scroll rows, and floating transport bar",
  keywords: [
    "music player", "audio player", "video player", "media player",
    "podcast", "streaming", "playlist", "spotify", "player",
    "lofi", "radio", "sound", "mp3", "video", "movie",
  ],
  appShell: `\
import { useState } from "react";
import { Home, Search, Library, Play, SkipBack, SkipForward, Volume2, Music } from "lucide-react";
import { useDrag } from "./hooks/useDrag";

const NAV = [
  { id: "home", label: "Home", Icon: Home },
  { id: "search", label: "Search", Icon: Search },
  { id: "library", label: "Library", Icon: Library },
];

export default function App() {
  const [activeNav, setActiveNav] = useState("home");
  const onDrag = useDrag();

  return (
    <div className="h-screen overflow-hidden" style={{ background: "var(--surface-window)", position: "relative" }}>

      {/* Sidebar — absolute overlay with blur */}
      <div className="shrink-0 select-none" style={{
        position: "absolute", top: 0, left: 0, bottom: 0,
        width: 206, padding: "6px 0 6px 6px", zIndex: 20,
      }}>
        <aside className="flex flex-col h-full" onMouseDown={onDrag} style={{
          background: "rgba(24, 24, 24, 0.55)",
          backdropFilter: "blur(50px) saturate(1.8)",
          WebkitBackdropFilter: "blur(50px) saturate(1.8)",
          borderRadius: 12,
          border: "0.5px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          <div className="shrink-0 traffic-light-pad" />
          <nav className="flex-1 overflow-y-auto px-2.5">
            {NAV.map((item) => {
              const active = activeNav === item.id;
              return (
                <button key={item.id} onClick={() => setActiveNav(item.id)}
                  className="w-full flex items-center text-left" data-no-drag
                  style={{
                    padding: "6px 10px", marginBottom: 1, fontSize: 13,
                    fontWeight: active ? 500 : 400,
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    background: active ? "rgba(255,255,255,0.06)" : "transparent",
                    border: "none", cursor: "pointer", borderRadius: 8, gap: 8,
                    transition: "all 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <item.Icon size={15} strokeWidth={1.6} style={{ flexShrink: 0, opacity: active ? 0.9 : 0.45 }} />
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
      </div>

      {/* Header — transparent blur overlay + drag region for window dragging */}
      <div className="flex items-center justify-between select-none" onMouseDown={onDrag} style={{
        position: "absolute", top: 0, left: 206, right: 0,
        height: 48, padding: "0 20px",
        background: "rgba(20, 20, 20, 0.5)",
        backdropFilter: "blur(40px) saturate(1.6)",
        WebkitBackdropFilter: "blur(40px) saturate(1.6)",
        borderBottom: "0.5px solid rgba(255,255,255,0.04)",
        zIndex: 15,
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Home</h1>
      </div>

      {/* Full-width scrollable content */}
      <main className="h-full overflow-y-auto hide-scrollbar" style={{
        paddingTop: 64, paddingBottom: 80,
        scrollBehavior: "smooth",
      }}>
        {/* Horizontal scroll rows with paddingLeft: 220 to offset for sidebar */}
        {/* Album/playlist cards go here */}
      </main>

      {/* Floating transport bar — liquid glass, inside content area */}
      <div className="flex items-center justify-between select-none" style={{
        position: "absolute", bottom: 10, left: 216, right: 10,
        height: 56, borderRadius: 16, padding: "0 20px",
        background: "rgba(28, 28, 30, 0.55)",
        backdropFilter: "blur(40px) saturate(1.8)",
        WebkitBackdropFilter: "blur(40px) saturate(1.8)",
        border: "0.5px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.35), inset 0 0.5px 0 rgba(255, 255, 255, 0.06)",
        zIndex: 15,
      }}>
        <div className="flex items-center gap-3" style={{ minWidth: 160 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #0A84FF, #5AC8FA)", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Track Title</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Artist</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <SkipBack size={16} strokeWidth={1.5} style={{ color: "var(--text-secondary)", cursor: "pointer" }} />
          <button style={{
            width: 34, height: 34, borderRadius: "50%", border: "none",
            background: "rgba(255, 255, 255, 0.12)", color: "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
          }}>
            <Play size={14} fill="#fff" strokeWidth={0} style={{ marginLeft: 2 }} />
          </button>
          <SkipForward size={16} strokeWidth={1.5} style={{ color: "var(--text-secondary)", cursor: "pointer" }} />
        </div>
        <div className="flex items-center gap-2" style={{ minWidth: 120, justifyContent: "flex-end" }}>
          <Volume2 size={14} strokeWidth={1.5} style={{ color: "var(--text-tertiary)" }} />
          <div style={{ width: 80, height: 3, borderRadius: 2, background: "rgba(255, 255, 255, 0.1)" }}>
            <div style={{ width: "65%", height: "100%", borderRadius: 2, background: "rgba(255, 255, 255, 0.4)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
`,
  components: [],
  cssAdditions: "",
  promptContext: `This is a MEDIA PLAYER layout (Apple Music style). NO title bar — traffic lights float over the sidebar. The app has:
- An ABSOLUTE sidebar overlay (position: absolute, zIndex: 20) with heavy blur (50px) and semi-transparent background. The sidebar <aside> MUST have onMouseDown={onDrag} using useDrag() hook so the entire sidebar is draggable. Its first child is a spacer with class "traffic-light-pad". All buttons/inputs inside MUST have data-no-drag attribute.
- A transparent blur header overlay (position: absolute, zIndex: 15) with onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- Full-width scrollable content with horizontal scroll rows (use paddingLeft: 220 to offset for sidebar)
- A floating liquid glass transport bar (position: absolute, bottom: 10, borderRadius: 16, backdrop-filter blur(40px))

MEDIA-SPECIFIC PATTERNS:
- Horizontal scroll rows: flex container with overflowX: auto, hide-scrollbar class, flexShrink: 0 cards
- Album/playlist cards: organic multi-blob gradients using radial-gradient(circle at X% Y%, color, transparent). borderRadius: 16-24.
- Card hover: scale only the INNER content (overflow: hidden on outer, transform scale(1.08) on inner div). Do NOT scale the card container.
- List view: grid rows with colored album art thumbnails (28x28, borderRadius: 5, gradient background)
- Transport bar sits only in the content area (left: 216, not full width)

You MUST generate:
- src/App.tsx — the complete layout with playback state, track data, horizontal scroll rows of cards, and list/grid view toggle
- Additional components as needed

The sidebar, header, and transport bar are positioned absolutely. The main content scrolls behind the sidebar blur.`,
  layoutRules: SHARED_LAYOUT_RULES,
};
