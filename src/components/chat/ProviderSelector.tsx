import { Check, Lock } from "lucide-react";
import { Popover } from "../common";
import type { AiProviderId } from "../../lib/ai/types";

const PROVIDERS: Array<{ id: AiProviderId; name: string; keyId: string }> = [
  { id: "gemini",              name: "Gemini",               keyId: "google" },
  { id: "anthropic",          name: "Anthropic",            keyId: "anthropic" },
  { id: "openai",             name: "OpenAI Compatible",    keyId: "openai-compatible-key" },
  { id: "anthropic-compatible", name: "Anthropic Compatible", keyId: "anthropic-compatible-key" },
];

function hasApiKey(keyId: string): boolean {
  try {
    const keys = JSON.parse(localStorage.getItem("raincast-api-keys") || "{}");
    return !!keys[keyId];
  } catch {
    return false;
  }
}

interface Props {
  activeId: AiProviderId;
  onSelect: (id: AiProviderId) => void;
  onClose: () => void;
}

export default function ProviderSelector({ activeId, onSelect, onClose }: Props) {
  return (
    <Popover onClose={onClose} width={200} style={{ top: "100%", left: 0, marginTop: 6 }}>
      {PROVIDERS.map((p) => {
        const isSelected = p.id === activeId;
        const locked = !hasApiKey(p.keyId);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => { if (!locked) { onSelect(p.id); onClose(); } }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "7px 12px",
              borderRadius: 8,
              border: "none",
              background: isSelected ? "var(--subtle-bg)" : "transparent",
              cursor: locked ? "default" : "pointer",
              opacity: locked ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (!locked) e.currentTarget.style.background = "var(--btn-subtle-hover-bg)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? "var(--subtle-bg)" : "transparent"; }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", flex: 1, textAlign: "left" }}>{p.name}</span>
            {isSelected && <Check size={14} strokeWidth={2.5} style={{ color: "var(--text-primary)", flexShrink: 0 }} />}
            {locked && !isSelected && <Lock size={12} strokeWidth={2} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />}
          </button>
        );
      })}
    </Popover>
  );
}
