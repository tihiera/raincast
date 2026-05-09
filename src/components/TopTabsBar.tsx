import { useState, useCallback, useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { KeyRound, Palette, Eye, EyeOff, ChevronRight } from "lucide-react";
import { useAppearance, APPEARANCES, type Appearance } from "../ThemeContext";
import { useProjectContext } from "../lib/project/ProjectContext";
import { getActiveProviderId, setActiveProviderId } from "../lib/ai/settings";
import type { AiProviderId } from "../lib/ai/types";

const AI_PROVIDERS: Array<{ id: string; name: string; providerId?: AiProviderId; hasCustomUrl?: boolean }> = [
  { id: "google",               name: "Google Gemini",        providerId: "gemini" },
  { id: "anthropic",            name: "Anthropic Claude",     providerId: "anthropic" },
  { id: "xai",                  name: "xAI" },
  { id: "openai",               name: "OpenAI Compatible",   providerId: "openai",              hasCustomUrl: true },
  { id: "anthropic-compatible", name: "Anthropic Compatible", providerId: "anthropic-compatible", hasCustomUrl: true },
];

const SEARCH_PROVIDERS: Array<{ id: string; name: string; hint: string }> = [
  { id: "brave", name: "Brave Search", hint: "Free: 2000 queries/month" },
];

const TAB_MAX_W = 180;
const TAB_MIN_W = 120;

const appWindow = getCurrentWindow();

/* ── API Key popover ── */
function ApiKeyModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("raincast-api-keys");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        console.warn("[ApiKeyModal] Corrupted API keys in localStorage — resetting");
        return {};
      }
      return parsed;
    } catch {
      console.warn("[ApiKeyModal] Failed to parse API keys from localStorage — resetting");
      return {};
    }
  });
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<AiProviderId>(getActiveProviderId);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  function updateKey(providerId: string, value: string) {
    const next = { ...keys, [providerId]: value };
    setKeys(next);
    localStorage.setItem("raincast-api-keys", JSON.stringify(next));
  }

  async function loadModels(providerId: string) {
    const baseUrl = (keys[`${providerId}-url`] || "").trim();
    const apiKey = keys[providerId] || "";
    if (!apiKey || !baseUrl) return;

    setLoadingModels((prev) => ({ ...prev, [providerId]: true }));
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const modelList: string[] = Array.isArray(data.data)
        ? data.data.map((m: { id: string }) => m.id)
        : Array.isArray(data)
        ? data.map((m: string) => m)
        : [];
      setModels((prev) => ({ ...prev, [providerId]: modelList }));
    } catch (err) {
      console.warn("[loadModels]", err);
    } finally {
      setLoadingModels((prev) => ({ ...prev, [providerId]: false }));
    }
  }

  function updateCustomUrl(providerId: string, value: string) {
    const next = { ...keys, [`${providerId}-url`]: value };
    setKeys(next);
    localStorage.setItem("raincast-api-keys", JSON.stringify(next));
  }

  function updateCustomModel(providerId: string, value: string) {
    const next = { ...keys, [`${providerId}-model`]: value };
    setKeys(next);
    localStorage.setItem("raincast-api-keys", JSON.stringify(next));
  }

  return (
    <div
      ref={ref}
      data-no-drag
      style={{
        position: "absolute",
        top: 36,
        right: 0,
        width: 300,
        padding: "10px 10px 12px",
        background: "var(--popover-bg)",
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)",
        border: "1px solid var(--popover-border)",
        zIndex: 100,
      }}
    >
      <p style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-secondary)",
        marginBottom: 8,
        paddingLeft: 6,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        Providers
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {AI_PROVIDERS.map((p) => {
          const isOpen = expandedId === p.id;
          const hasKey = !!keys[p.id];
          const isActive = p.providerId === activeProvider;

          return (
            <div key={p.id}>
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 8px",
                  borderRadius: 10,
                  border: "none",
                  background: isOpen ? "var(--subtle-bg)" : "transparent",
                  cursor: "pointer",
                  transition: "background 150ms ease, opacity 150ms ease",
                  opacity: hasKey ? 1 : 0.7,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; if (!isOpen) e.currentTarget.style.background = "var(--subtle-bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = hasKey ? "1" : "0.7"; if (!isOpen) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: hasKey ? "#34c759" : "var(--text-tertiary)",
                  flexShrink: 0,
                  transition: "background 200ms ease",
                }} />

                <span style={{
                  fontSize: 13,
                  fontWeight: hasKey ? 600 : 500,
                  color: hasKey ? "var(--text-primary)" : "var(--text-secondary)",
                  flex: 1,
                  textAlign: "left",
                  transition: "color 200ms ease",
                }}>
                  {p.name}
                </span>

                {isActive && hasKey && (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#34c759",
                    marginRight: 2,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}>
                    Active
                  </span>
                )}
                {!hasKey && !isOpen && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginRight: 2,
                  }}>
                    Not set
                  </span>
                )}

                <ChevronRight
                  size={12}
                  strokeWidth={2}
                  style={{
                    color: "var(--text-tertiary)",
                    transition: "transform 200ms ease",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    flexShrink: 0,
                  }}
                />
              </button>

              {isOpen && (
                <div style={{ padding: "6px 8px 10px 23px" }}>
                  <label style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-tertiary)",
                    marginBottom: 4,
                    display: "block",
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                  }}>
                    API Key
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={visibleId === p.id ? "text" : "password"}
                      value={keys[p.id] || ""}
                      onChange={(e) => updateKey(p.id, e.target.value)}
                      placeholder={`Enter ${p.name} API key...`}
                      style={{
                        width: "100%",
                        padding: "6px 30px 6px 10px",
                        fontSize: 12,
                        borderRadius: 8,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--text-input)",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--slider-thumb)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; }}
                    />
                    <button
                      type="button"
                      onClick={() => setVisibleId(visibleId === p.id ? null : p.id)}
                      style={{
                        position: "absolute",
                        right: 6,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-tertiary)",
                        display: "flex",
                        alignItems: "center",
                        padding: 2,
                      }}
                    >
                      {visibleId === p.id
                        ? <EyeOff size={13} strokeWidth={1.8} />
                        : <Eye size={13} strokeWidth={1.8} />
                      }
                    </button>
                  </div>

                  {p.hasCustomUrl && (
                    <>
                      <label style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--text-tertiary)",
                        marginBottom: 4,
                        marginTop: 8,
                        display: "block",
                        letterSpacing: "0.03em",
                        textTransform: "uppercase",
                      }}>
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={keys[`${p.id}-url`] || ""}
                        onChange={(e) => updateCustomUrl(p.id, e.target.value)}
                        placeholder={p.id === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com/v1"}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--text-input)",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--slider-thumb)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; }}
                      />

                      <button
                        type="button"
                        onClick={() => loadModels(p.id)}
                        disabled={loadingModels[p.id] || !keys[p.id] || !keys[`${p.id}-url`]}
                        style={{
                          marginTop: 8,
                          width: "100%",
                          padding: "5px 0",
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 6,
                          border: "1px solid var(--input-border)",
                          background: "var(--subtle-bg)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          opacity: loadingModels[p.id] || !keys[p.id] || !keys[`${p.id}-url`] ? 0.5 : 1,
                          transition: "background 150ms ease",
                        }}
                        onMouseEnter={(e) => { if (!loadingModels[p.id] && keys[p.id] && keys[`${p.id}-url`]) e.currentTarget.style.background = "var(--input-border)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--subtle-bg)"; }}
                      >
                        {loadingModels[p.id] ? "Loading..." : "Load Models"}
                      </button>

                      {(models[p.id] || []).length > 0 && (
                        <select
                          value={keys[`${p.id}-model`] || ""}
                          onChange={(e) => updateCustomModel(p.id, e.target.value)}
                          style={{
                            marginTop: 6,
                            width: "100%",
                            padding: "5px 8px",
                            fontSize: 12,
                            borderRadius: 6,
                            border: "1px solid var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--text-input)",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        >
                          <option value="">Select model...</option>
                          {models[p.id].map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}

                  {p.providerId && hasKey && !isActive && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProviderId(p.providerId!);
                        setActiveProvider(p.providerId!);
                      }}
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: "5px 0",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: "1px solid var(--input-border)",
                        background: "var(--subtle-bg)",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        transition: "background 150ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--input-border)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--subtle-bg)"; }}
                    >
                      Use {p.name}
                    </button>
                  )}
                  {isActive && (
                    <p style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: "#34c759",
                      fontWeight: 600,
                    }}>
                      Currently active
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Search section ── */}
      <div style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid var(--popover-border)",
      }}>
        <p style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: 8,
          paddingLeft: 6,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}>
          Search
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {SEARCH_PROVIDERS.map((p) => {
            const isOpen = expandedId === p.id;
            const hasKey = !!keys[p.id];

            return (
              <div key={p.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : p.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 8px",
                    borderRadius: 10,
                    border: "none",
                    background: isOpen ? "var(--subtle-bg)" : "transparent",
                    cursor: "pointer",
                    transition: "background 150ms ease, opacity 150ms ease",
                    opacity: hasKey ? 1 : 0.7,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; if (!isOpen) e.currentTarget.style.background = "var(--subtle-bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = hasKey ? "1" : "0.7"; if (!isOpen) e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: hasKey ? "#34c759" : "var(--text-tertiary)",
                    flexShrink: 0,
                    transition: "background 200ms ease",
                  }} />

                  <span style={{
                    fontSize: 13,
                    fontWeight: hasKey ? 600 : 500,
                    color: hasKey ? "var(--text-primary)" : "var(--text-secondary)",
                    flex: 1,
                    textAlign: "left",
                    transition: "color 200ms ease",
                  }}>
                    {p.name}
                  </span>

                  {!hasKey && !isOpen && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      marginRight: 2,
                    }}>
                      Not set
                    </span>
                  )}

                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    style={{
                      color: "var(--text-tertiary)",
                      transition: "transform 200ms ease",
                      transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                      flexShrink: 0,
                    }}
                  />
                </button>

                {isOpen && (
                  <div style={{ padding: "6px 8px 10px 23px" }}>
                    <label style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--text-tertiary)",
                      marginBottom: 4,
                      display: "block",
                      letterSpacing: "0.03em",
                      textTransform: "uppercase",
                    }}>
                      API Key
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={visibleId === p.id ? "text" : "password"}
                        value={keys[p.id] || ""}
                        onChange={(e) => updateKey(p.id, e.target.value)}
                        placeholder={`Enter ${p.name} API key...`}
                        style={{
                          width: "100%",
                          padding: "6px 30px 6px 10px",
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--text-input)",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--slider-thumb)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--input-border)"; }}
                      />
                      <button
                        type="button"
                        onClick={() => setVisibleId(visibleId === p.id ? null : p.id)}
                        style={{
                          position: "absolute",
                          right: 6,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-tertiary)",
                          display: "flex",
                          alignItems: "center",
                          padding: 2,
                        }}
                      >
                        {visibleId === p.id
                          ? <EyeOff size={13} strokeWidth={1.8} />
                          : <Eye size={13} strokeWidth={1.8} />
                        }
                      </button>
                    </div>
                    <p style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: "var(--text-tertiary)",
                      lineHeight: 1.4,
                    }}>
                      {p.hint}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Appearance slider popover ── */
function AppearanceSlider({ onClose }: { onClose: () => void }) {
  const { appearance, setAppearance } = useAppearance();
  const ref = useRef<HTMLDivElement>(null);

  const currentIndex = APPEARANCES.findIndex((a) => a.id === appearance);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const THUMB_COLORS: Record<Appearance, string> = {
    ocean: "#7bbde8",
    sunset: "#e8b87b",
    aurora: "#a87ed4",
    midnight: "#8e8e8e",
  };

  const TRACK_FILLS: Record<Appearance, string> = {
    ocean: "linear-gradient(90deg, #BADDF9 0%, #7bbde8 100%)",
    sunset: "linear-gradient(90deg, #FDD29F 0%, #e8b87b 100%)",
    aurora: "linear-gradient(90deg, #c8a2e8 0%, #7eb4e8 50%, #e89f6e 100%)",
    midnight: "linear-gradient(90deg, #424242 0%, #6e6e6e 50%, #8e8e8e 100%)",
  };

  return (
    <div
      ref={ref}
      data-no-drag
      style={{
        position: "absolute",
        top: 36,
        right: 0,
        width: 220,
        padding: "14px 16px 16px",
        background: "var(--popover-bg)",
        borderRadius: 14,
        boxShadow:
          "0 8px 32px rgba(0, 0, 0, 0.10), 0 2px 8px rgba(0, 0, 0, 0.06)",
        border: "1px solid var(--popover-border)",
        zIndex: 100,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: 12,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        Appearance
      </p>

      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 3,
          background: "var(--slider-track)",
          cursor: "pointer",
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          const idx = Math.round(pct * (APPEARANCES.length - 1));
          setAppearance(APPEARANCES[Math.max(0, Math.min(idx, APPEARANCES.length - 1))].id);
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${(currentIndex / (APPEARANCES.length - 1)) * 100}%`,
            borderRadius: 3,
            background: TRACK_FILLS[appearance],
            transition: "width 400ms cubic-bezier(0.4, 0, 0.2, 1), background 400ms ease",
          }}
        />

        {APPEARANCES.map((a, i) => (
          <div
            key={a.id}
            onClick={(e) => {
              e.stopPropagation();
              setAppearance(a.id);
            }}
            style={{
              position: "absolute",
              top: "50%",
              left: `${(i / (APPEARANCES.length - 1)) * 100}%`,
              width: 10,
              height: 10,
              borderRadius: "50%",
              transform: "translate(-50%, -50%)",
              background:
                i <= currentIndex ? THUMB_COLORS[a.id] : "var(--pane-bg)",
              border:
                i <= currentIndex
                  ? `2px solid ${THUMB_COLORS[a.id]}`
                  : "2px solid var(--separator-color)",
              transition:
                "background 400ms ease, border-color 400ms ease, transform 200ms ease",
              cursor: "pointer",
              boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
            }}
          />
        ))}

        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${(currentIndex / (APPEARANCES.length - 1)) * 100}%`,
            width: 18,
            height: 18,
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
            background: THUMB_COLORS[appearance],
            boxShadow: `0 2px 8px rgba(0,0,0,0.15), 0 0 0 3px var(--popover-bg)`,
            transition:
              "left 400ms cubic-bezier(0.4, 0, 0.2, 1), background 400ms ease",
            cursor: "grab",
            zIndex: 2,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 10,
        }}
      >
        {APPEARANCES.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAppearance(a.id)}
            style={{
              fontSize: 10,
              fontWeight: appearance === a.id ? 600 : 400,
              color:
                appearance === a.id
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: 4,
              transition: "color 300ms ease, font-weight 300ms ease",
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function TopTabsBar() {
  const { active } = useProjectContext();
  const [showAppearance, setShowAppearance] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;

    if (e.buttons === 1) {
      if (e.detail === 2) appWindow.toggleMaximize();
      else appWindow.startDragging();
    }
  }, []);

  return (
    <div
      onMouseDown={handleDrag}
      className="h-[42px] px-3 flex shrink-0"
      style={{
        paddingTop: 6,
        cursor: "default",
        userSelect: "none",
      }}
    >
      {/* macOS traffic light spacer */}
      <div className="shrink-0" style={{ width: 74 }} />

      {/* Active project title (single, non-interactive) */}
      <div className="flex items-center flex-1 min-w-0 overflow-visible px-2">
        <div
          className="flex items-center min-w-0"
          style={{ paddingBottom: 1 }}
        >
          <div
            className="rain-tab is-active"
            style={{ maxWidth: TAB_MAX_W, minWidth: TAB_MIN_W, pointerEvents: "none" }}
          >
            {active.icon && (
              <img
                src={active.icon}
                alt=""
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  objectFit: "cover",
                  flexShrink: 0,
                  marginRight: 2,
                }}
              />
            )}
            <span className="truncate text-left flex-1">{active.title}</span>
          </div>
        </div>
      </div>

      {/* Right-side buttons */}
      <div className="flex items-center gap-2 relative" data-no-drag>
        {/* API Key */}
        <button
          type="button"
          onClick={() => { setShowApiKeys((v) => !v); setShowAppearance(false); }}
          className="inline-flex items-center justify-center rounded-lg"
          style={{
            width: 28,
            height: 28,
            color: "var(--icon-color)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--icon-hover-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          title="API Keys"
        >
          <KeyRound size={15} strokeWidth={1.8} />
        </button>

        {/* Appearance */}
        <button
          type="button"
          onClick={() => { setShowAppearance((v) => !v); setShowApiKeys(false); }}
          className="inline-flex items-center justify-center rounded-lg"
          style={{
            width: 28,
            height: 28,
            color: "var(--icon-color)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--icon-hover-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
          title="Appearance"
        >
          <Palette size={15} strokeWidth={1.8} />
        </button>

        {showApiKeys && (
          <ApiKeyModal onClose={() => setShowApiKeys(false)} />
        )}
        {showAppearance && (
          <AppearanceSlider onClose={() => setShowAppearance(false)} />
        )}
      </div>
    </div>
  );
}
