import type { LayoutTemplate } from "./index";
import { SHARED_LAYOUT_RULES } from "./styles";

export const chat: LayoutTemplate = {
  id: "chat",
  name: "Chat",
  description: "Messaging or conversation UI with thread list, messages, and input",
  keywords: [
    "chat", "messaging", "messenger", "conversation", "message",
    "ai assistant", "chatbot", "bot", "slack", "discord", "whatsapp",
    "support", "customer support", "helpdesk", "inbox",
  ],
  appShell: `\
import ConversationList from "./components/ConversationList";
import MessageThread from "./components/MessageThread";
import ChatInput from "./components/ChatInput";
import { useDrag } from "./hooks/useDrag";

export default function App() {
  const onDrag = useDrag();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--surface-window)" }}>
      <ConversationList />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center px-5 shrink-0 select-none" onMouseDown={onDrag}
          style={{ height: 48, borderBottom: "0.5px solid var(--border-secondary)" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Conversation</h2>
        </header>
        <MessageThread />
        <ChatInput />
      </div>
    </div>
  );
}
`,
  components: [
    {
      path: "src/components/ConversationList.tsx",
      content: `\
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useDrag } from "../hooks/useDrag";

export default function ConversationList() {
  const [active, setActive] = useState(0);
  const onDrag = useDrag();

  return (
    <div className="shrink-0 select-none" style={{ width: 260, padding: "6px 0 6px 6px" }}>
      <aside className="flex flex-col h-full" onMouseDown={onDrag} style={{
        background: "var(--surface-sidebar)",
        backdropFilter: "blur(20px) saturate(1.4)",
        WebkitBackdropFilter: "blur(20px) saturate(1.4)",
        borderRadius: 12,
        border: "0.5px solid var(--border-secondary)",
        overflow: "hidden",
      }}>
        <div className="shrink-0 traffic-light-pad" />
        <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 44 }}>
          <MessageSquare size={14} strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Messages</span>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5">
          {/* Conversation items go here */}
        </div>
      </aside>
    </div>
  );
}
`,
    },
    {
      path: "src/components/MessageThread.tsx",
      content: `\
export default function MessageThread() {
  return (
    <main className="flex-1 overflow-y-auto" style={{ padding: 20 }}>
      {/* Message bubbles — use borderRadius: 12, padding: "8px 14px", fontSize: 13 */}
      <div style={{
        maxWidth: "75%", borderRadius: 12, padding: "8px 14px",
        background: "var(--surface-raised)", border: "0.5px solid var(--border-secondary)",
        marginBottom: 8,
      }}>
        <p style={{ fontSize: 13, color: "var(--text-primary)", margin: 0 }}>Hello! This is a message.</p>
        <span style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 4, display: "block" }}>12:00 PM</span>
      </div>
    </main>
  );
}
`,
    },
    {
      path: "src/components/ChatInput.tsx",
      content: `\
import { Send } from "lucide-react";

export default function ChatInput() {
  return (
    <footer className="shrink-0" style={{ padding: "12px 16px", borderTop: "0.5px solid var(--border-secondary)" }}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Type a message..."
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 13,
            border: "0.5px solid var(--border-secondary)", background: "var(--surface-inset)",
            color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
          }}
        />
        <button style={{
          width: 32, height: 32, borderRadius: 8, border: "none",
          background: "var(--accent)", color: "#fff", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Send size={14} strokeWidth={1.5} />
        </button>
      </div>
    </footer>
  );
}
`,
    },
  ],
  cssAdditions: "",
  promptContext: `This is a CHAT / MESSAGING layout. NO title bar — traffic lights float over the sidebar. The app has:
- A rounded sidebar card (borderRadius: 12, backdrop-filter blur) for conversation list, 260px wide. The sidebar <aside> MUST have onMouseDown={onDrag} using useDrag() hook so the entire sidebar is draggable. Its first child is a spacer with class "traffic-light-pad". All buttons/inputs inside MUST have data-no-drag attribute.
- A header bar (48px) showing current conversation name, with onMouseDown={onDrag} using useDrag() hook so the window can be dragged. Interactive elements inside MUST have data-no-drag attribute.
- A scrollable message thread area with message bubbles
- A fixed input bar at the bottom with text input and send button

You MUST generate:
- src/App.tsx — wire up state for conversations and messages
- src/components/ConversationList.tsx — conversation items with unread badges, online status dots
- src/components/MessageThread.tsx — message bubbles (borderRadius: 12, var(--surface-raised))
- src/components/ChatInput.tsx — input bar with attachment/emoji buttons
- src/components/*.tsx — additional components

The conversation list, header, and input bar are FIXED. Only the message thread scrolls.
Use online dots: 6px circle, #34C759 (online), #FF9F0A (away), var(--text-tertiary) (offline).`,
  layoutRules: SHARED_LAYOUT_RULES,
};
