import { useRef, useCallback, useState, useEffect } from "react";
import { SquarePen, ChevronDown } from "lucide-react";
import ProviderSelector from "./ProviderSelector";
import UserBubble from "./UserBubble";
import AiResponse from "./AiResponse";
// StatusTicker removed — generation steps are visible in the preview pane
import ChatInput from "./ChatInput";
import GenerationTimeline from "./GenerationTimeline";
import { useGenerationContext } from "../../lib/generation/GenerationContext";
import { usePreviewContext } from "../../lib/preview/PreviewContext";
import { useProjectContext } from "../../lib/project/ProjectContext";
import { useSketchContext } from "../../lib/sketch/SketchContext";
import { getProviderById } from "../../lib/ai";
import { getActiveProviderId, setActiveProviderId } from "../../lib/ai/settings";
import { saveAppIcon } from "../../lib/tauri/workspace";
import type { ChatMessage, ImageAttachment } from "../../lib/chat/types";

/** Name picker shown inline in chat — auto-selects first name after 15s if user doesn't pick. */
function NamePicker({ msgId, names, onPick }: { msgId: string; names: string[]; onPick: (name: string) => void }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const pickedRef = useRef(false);

  // Auto-pick the first name after 20 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!pickedRef.current && names.length > 0) {
        pickedRef.current = true;
        onPick(names[0]);
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [msgId, names, onPick]);

  return (
    <div style={{
      padding: "10px 16px",
      margin: "6px 0",
      animation: "fadeIn 0.3s ease-out",
    }}>
      <p style={{
        fontSize: 13,
        color: "var(--text-secondary)",
        marginBottom: 8,
        lineHeight: 1.5,
      }}>
        Here are some name ideas for your app. Tap one to use it:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {names.map((name, i) => (
          <div
            key={name}
            onClick={() => { pickedRef.current = true; onPick(name); }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 10px",
              borderRadius: 8,
              cursor: "pointer",
              transition: "background 0.12s",
              background: hoveredIdx === i ? "var(--btn-subtle-hover-bg)" : "transparent",
            }}
          >
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-tertiary)",
              width: 16,
              textAlign: "right",
              flexShrink: 0,
            }}>
              {i + 1}.
            </span>
            <span style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: hoveredIdx === i ? "var(--text-primary)" : "var(--text-secondary)",
              transition: "color 0.12s",
            }}>
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** SVG → PNG conversion using an offscreen canvas. */
/** Render any image source (SVG string, data URL, etc.) to a proper PNG base64 string via canvas. */
function toPngBase64(src: string, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let imgSrc: string;
    let blobUrl: string | null = null;

    if (src.startsWith("data:")) {
      // Data URL (from Gemini) — could be JPEG or PNG, canvas normalizes to PNG
      imgSrc = src;
    } else {
      // SVG string — create a blob URL
      const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
      blobUrl = URL.createObjectURL(blob);
      imgSrc = blobUrl;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      // Force RGBA: WebKit may produce RGB PNG when all pixels are opaque (e.g. from JPEG).
      // Tauri requires RGBA icons, so nudge one corner pixel's alpha to 254 (imperceptible).
      const px = ctx.getImageData(0, 0, 1, 1);
      if (px.data[3] === 255) {
        px.data[3] = 254;
        ctx.putImageData(px, 0, 0);
      }
      const dataUrl = canvas.toDataURL("image/png");
      // Strip the "data:image/png;base64," prefix
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      reject(new Error("Image render failed"));
    };
    img.src = imgSrc;
  });
}

/** Logo picker — shows 3 logo variants (data URLs or SVG strings) as selectable icons. */
function LogoPicker({ svgs, onPick }: { svgs: string[]; onPick: (svg: string) => void }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const pickedRef = useRef(false);
  const isDataUrl = (s: string) => s.startsWith("data:");

  // Auto-pick the first logo after 20 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!pickedRef.current && svgs.length > 0) {
        pickedRef.current = true;
        onPick(svgs[0]);
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [svgs, onPick]);

  return (
    <div style={{
      padding: "10px 16px",
      margin: "6px 0",
      animation: "fadeIn 0.3s ease-out",
    }}>
      <p style={{
        fontSize: 13,
        color: "var(--text-secondary)",
        marginBottom: 10,
        lineHeight: 1.5,
      }}>
        Here are some logo options. Tap to use one, or describe changes you'd like:
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        {svgs.map((item, i) => {
          const shared = {
            width: 72,
            height: 72,
            borderRadius: 14,
            border: hoveredIdx === i
              ? "2px solid var(--slider-thumb)"
              : "2px solid var(--separator-color)",
            background: "var(--btn-subtle-hover-bg)",
            cursor: "pointer" as const,
            transition: "border-color 0.15s, transform 0.15s",
            transform: hoveredIdx === i ? "scale(1.05)" : "scale(1)",
            overflow: "hidden" as const,
            display: "flex",
            alignItems: "center" as const,
            justifyContent: "center" as const,
          };
          return isDataUrl(item) ? (
            <div
              key={i}
              onClick={() => { pickedRef.current = true; onPick(item); }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={shared}
            >
              <img src={item} alt={`Logo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} />
            </div>
          ) : (
            <div
              key={i}
              onClick={() => { pickedRef.current = true; onPick(item); }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={shared}
              dangerouslySetInnerHTML={{ __html: item }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Ephemeral tool status shown during the agent loop */
interface ToolStatus {
  text: string;
  tool?: string;
  args?: string;
  seq: number;
}

/** Per-project ephemeral UI state (thinking, streaming, tool status) */
interface TabState {
  thinking: boolean;
  streamingId: string | null;
  toolStatus: ToolStatus | null;
}

/** Hook that reveals a string character by character (typewriter). */
function useTypewriter(text: string, speed = 18): string {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, shown);
}

/** Animated tool call status shown in chat during the agent loop. */
function ToolCallStatus({ status }: { status: ToolStatus }) {
  const visibleText = useTypewriter(status.text || "", 18);
  const toolLabel = status.tool ? `${status.tool}(${status.args || ""})` : "";
  const visibleTool = useTypewriter(toolLabel, 12);

  return (
    <div style={{
      padding: "6px 16px",
      margin: "4px 0",
      animation: "toolStatusSlideIn 0.3s ease-out",
    }}>
      {status.text && (
        <div style={{
          fontSize: 12.5,
          color: "var(--text-secondary)",
          marginBottom: status.tool ? 5 : 0,
          fontWeight: 500,
        }}>
          {visibleText}
        </div>
      )}
      {status.tool && (
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 8,
          background: "var(--input-bg)",
          border: "1px solid var(--separator-color)",
          fontSize: 11,
          color: "var(--text-tertiary)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          animation: "toolStatusSlideIn 0.3s ease-out",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap" as const,
        }}>
          <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Tool:</span>
          {" "}{visibleTool}
        </div>
      )}
    </div>
  );
}

export default function ChatPane() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showProviderSelector, setShowProviderSelector] = useState(false);
  const [activeProviderId, setActiveProviderState] = useState(getActiveProviderId);
  const [inputValue, setInputValue] = useState("");
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);

  // Per-tab UI state stored in a map so tabs don't interfere
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});

  const { status, isRunning, hasProject, start, cancel } = useGenerationContext();
  const { startPreview, previewUrl, overlayText: previewOverlay } = usePreviewContext();
  const { active, activeId, createProject, updateMessages, renameProject, setProjectIcon } = useProjectContext();
  const { pendingInsert, consumeInsert } = useSketchContext();
  const prevPhaseRef = useRef(status.phase);

  // Consume sketch-inserted images
  useEffect(() => {
    if (pendingInsert) {
      setPendingImages((prev) => [...prev, pendingInsert]);
      consumeInsert();
    }
  }, [pendingInsert, consumeInsert]);

  // Save & restore scroll position per tab
  const scrollPositions = useRef<Record<string, number>>({});
  const prevActiveId = useRef(activeId);
  useEffect(() => {
    const prevId = prevActiveId.current;
    if (prevId !== activeId) {
      // Save scroll position of the tab we're leaving
      if (scrollContainerRef.current) {
        scrollPositions.current[prevId] = scrollContainerRef.current.scrollTop;
      }
      // Restore scroll position of the tab we're entering
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollPositions.current[activeId] ?? 0;
        }
      });
      prevActiveId.current = activeId;
    }
  }, [activeId]);

  // Read from active project
  const messages = active.messages;

  // Read thinking/streaming/toolStatus for the active tab only
  const tabState = tabStates[activeId];
  const thinking = tabState?.thinking ?? false;
  const streamingId = tabState?.streamingId ?? null;
  const toolStatus = tabState?.toolStatus ?? null;

  const defaultTab = { thinking: false, streamingId: null, toolStatus: null };

  // Helpers to update a specific tab's state
  const setTabThinking = useCallback((tabId: string, value: boolean) => {
    setTabStates((prev) => ({
      ...prev,
      [tabId]: { ...(prev[tabId] ?? defaultTab), thinking: value },
    }));
  }, []);

  const setTabStreamingId = useCallback((tabId: string, value: string | null) => {
    setTabStates((prev) => ({
      ...prev,
      [tabId]: { ...(prev[tabId] ?? defaultTab), streamingId: value },
    }));
  }, []);

  const toolStatusSeq = useRef(0);
  const lastToolStatusText = useRef<Record<string, string | null>>({});
  const setTabToolStatus = useCallback((tabId: string, value: { text: string; tool?: string; args?: string } | null) => {
    const newText = value?.text ?? null;
    const prevText = lastToolStatusText.current[tabId] ?? null;
    // Skip update if text is identical — avoids re-triggering the slide-in animation
    if (newText === prevText) return;
    lastToolStatusText.current[tabId] = newText;
    toolStatusSeq.current++;
    const seq = toolStatusSeq.current;
    setTabStates((prev) => ({
      ...prev,
      [tabId]: { ...(prev[tabId] ?? defaultTab), toolStatus: value ? { ...value, seq } : null },
    }));
  }, []);

  const handleSelectProvider = useCallback((id: "gemini" | "anthropic") => {
    setActiveProviderId(id);
    setActiveProviderState(id);
  }, []);

  const provider = getProviderById(activeProviderId);
  const providerLabel = provider?.label ?? activeProviderId;
  const hasMessages = messages.length > 0;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleNewChat = useCallback(async () => {
    await createProject();
  }, [createProject]);

  const handleSend = useCallback(async () => {
    if ((!inputValue.trim() && pendingImages.length === 0) || !provider || thinking) return;

    // Capture the project ID at send time so async callbacks target the right project
    const sendProjectId = activeId;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: "user",
      content: inputValue.trim(),
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
    };
    const updated = [...messages, userMsg];
    updateMessages(sendProjectId, updated);
    setInputValue("");
    setPendingImages([]);
    setTabThinking(sendProjectId, true);

    const appendAssistant = (content: string) => {
      const msg: ChatMessage = {
        id: String(Date.now() + Math.random()),
        role: "assistant",
        content,
      };
      updateMessages(sendProjectId, (prev) => [...prev, msg]);
      return msg;
    };

    const handleChatStatus = (msg: ChatMessage) => {
      updateMessages(sendProjectId, (prev) => [...prev, msg]);
    };

    const handleChatStatusAppend = (id: string, textChunk: string) => {
      updateMessages(sendProjectId, (prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, content: m.content + textChunk, statusData: m.statusData ? { ...m.statusData, label: m.content + textChunk } : undefined }
            : m
        )
      );
    };

    try {
      const decision = await provider.analyzeQuery({
        messages: updated,
        hasProject,
      });

      // analyzeQuery done — clear explicit thinking. From here, the UI-level
      // fallback (isRunning && !toolStatus && !streamingId) automatically shows
      // thinking dots during any gap between status updates.
      setTabThinking(sendProjectId, false);

      switch (decision.intent) {
        case "chat": {
          const streamMsgId = String(Date.now() + Math.random());
          const streamMsg: ChatMessage = { id: streamMsgId, role: "assistant", content: "" };
          let firstChunk = true;

          await provider.chatRespondStream({
            messages: updated,
            onChunk: (text) => {
              if (firstChunk) {
                firstChunk = false;
                updateMessages(sendProjectId, (prev) => [...prev, { ...streamMsg, content: text }]);
                setTabStreamingId(sendProjectId, streamMsgId);
              } else {
                updateMessages(sendProjectId, (prev) =>
                  prev.map((m) =>
                    m.id === streamMsgId ? { ...m, content: m.content + text } : m
                  )
                );
              }
            },
          });

          setTabStreamingId(sendProjectId, null);
          break;
        }

        case "build_app": {
          const aiMsg = appendAssistant(decision.message);
          const allMessages = [...updated, aiMsg];

          if (!isRunning) {
            // start() sets isRunning=true synchronously → UI fallback shows thinking dots
            // until the first onToolStatus arrives from the session.
            start(activeId, allMessages, "build", "Building your app...", undefined, handleChatStatus, handleChatStatusAppend, decision.layoutArchetype,
              (s) => setTabToolStatus(sendProjectId, s),
              undefined,
              decision.needsBackend ? "system" : "standard",
            );

            // Generate name + logos in parallel with the build
            provider.suggestAppNames({ messages: updated }).then((names) => {
              if (names.length > 0) {
                const pickerMsg: ChatMessage = {
                  id: `name-picker-${Date.now()}`,
                  role: "status",
                  content: "Pick a name for your app",
                  statusData: {
                    type: "name-picker",
                    nameSuggestions: names,
                  },
                };
                updateMessages(sendProjectId, (prev) => [...prev, pickerMsg]);

                // Generate logos (3 variants already run in parallel via Promise.all)
                const appName = names[0];
                provider.generateLogos({ messages: updated, appName }).then((svgs) => {
                  if (svgs.length > 0) {
                    const logoMsg: ChatMessage = {
                      id: `logo-picker-${Date.now()}`,
                      role: "status",
                      content: "Pick a logo",
                      statusData: { type: "logo-picker", logoSvgs: svgs },
                    };
                    updateMessages(sendProjectId, (prev) => [...prev, logoMsg]);
                  }
                });
              }
            });
          }
          break;
        }

        case "edit_app": {
          if (!hasProject) {
            appendAssistant("No app exists yet. Describe what you'd like to build first, and I'll generate it for you!");
            break;
          }

          const aiMsg = appendAssistant(decision.message);
          const allMessages = [...updated, aiMsg];

          if (!isRunning) {
            start(activeId, allMessages, "edit", "Applying edits...", undefined, handleChatStatus, handleChatStatusAppend, undefined,
              (s) => setTabToolStatus(sendProjectId, s),
              (name) => renameProject(sendProjectId, name),
            );
          }
          break;
        }

        case "generate_logo": {
          appendAssistant(decision.message);

          const appName = active.title.startsWith("App #") ? "App" : active.title;

          // Check if this is a refinement — use picker in chat first, then fall back to saved project icon
          const existingLogoPicker = [...messages].reverse().find((m: ChatMessage) => m.statusData?.type === "logo-picker");
          const existingSvg = existingLogoPicker?.statusData?.logoSvgs?.[0];
          const currentLogo = existingSvg || active.icon || null;

          const svgs = await (currentLogo
            ? provider.refineLogos({ messages: updated, appName, currentSvg: currentLogo, instructions: inputValue || decision.summary })
            : provider.generateLogos({ messages: updated, appName }));

          if (svgs.length > 0) {
            // Remove old logo picker if refining
            if (existingLogoPicker) {
              updateMessages(sendProjectId, (prev) => prev.filter((m) => m.id !== existingLogoPicker.id));
            }
            const logoMsg: ChatMessage = {
              id: `logo-picker-${Date.now()}`,
              role: "status",
              content: "Pick a logo",
              statusData: { type: "logo-picker", logoSvgs: svgs },
            };
            updateMessages(sendProjectId, (prev) => [...prev, logoMsg]);
          } else {
            appendAssistant("I couldn't generate logos this time. Try describing the style you want.");
          }
          break;
        }

        default: {
          appendAssistant(decision.message);
          break;
        }
      }
    } catch {
      appendAssistant("Something went wrong. Please try again.");
    }
  }, [inputValue, pendingImages, messages, isRunning, hasProject, start, provider, thinking, activeId, updateMessages, setTabThinking, setTabStreamingId, setTabToolStatus]);

  // Safety net: clear thinking + tool status when generation finishes
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      setTabThinking(activeId, false);
      setTabToolStatus(activeId, null);
    }
    wasRunning.current = isRunning;
  }, [isRunning, activeId, setTabThinking, setTabToolStatus]);

  // Auto-scroll only when new messages are added (not on tab switch)
  const prevMsgCount = useRef<Record<string, number>>({});
  useEffect(() => {
    const prevCount = prevMsgCount.current[activeId] ?? 0;
    if (messages.length > prevCount) {
      scrollToBottom();
    }
    prevMsgCount.current[activeId] = messages.length;
  }, [messages.length, activeId, scrollToBottom]);



  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = status.phase;
    // Start preview when generation transitions to "ready"
    if (status.phase === "ready" && prev !== "ready") {
      startPreview(activeId);
    }
  }, [status.phase, startPreview, activeId]);

  // Auto-restart preview when the user switches to a project tab that has a workspace
  // but no running preview. Skip initial mount to avoid spamming on app launch.
  const initialMountRef = useRef(true);
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    if (!hasProject || previewUrl || isRunning || previewOverlay) return;
    startPreview(activeId);
  }, [activeId, hasProject, previewUrl, isRunning, previewOverlay, startPreview]);

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden"
      style={{ background: "var(--pane-bg)" }}
    >
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="relative -translate-y-0.5">
          <button
            type="button"
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={() => setShowProviderSelector((v) => !v)}
            style={{ background: "none", border: "none", padding: 0 }}
          >
            <h2 className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{providerLabel}</h2>
            <ChevronDown size={14} strokeWidth={2} style={{ color: "var(--text-secondary)" }} />
          </button>
          {showProviderSelector && (
            <ProviderSelector
              activeId={activeProviderId}
              onSelect={handleSelectProvider}
              onClose={() => setShowProviderSelector(false)}
            />
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onClick={handleNewChat}
            title="New project"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--btn-subtle-hover-bg)"; e.currentTarget.style.color = "var(--btn-subtle-hover-text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            <SquarePen size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto rain-scroll px-5 py-6" style={{ paddingBottom: 16 }}>
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div style={{
              position: "relative",
              width: 64,
              height: 64,
              marginBottom: 20,
            }}>
              <div style={{
                position: "absolute",
                inset: -12,
                borderRadius: "50%",
                background: "var(--orb-glow)",
                filter: "blur(16px)",
                animation: "orb-pulse 3s ease-in-out infinite",
              }} />
              <div style={{
                position: "relative",
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: `radial-gradient(circle at 35% 35%, var(--orb-color-3), var(--orb-color-1) 50%, var(--orb-color-2) 100%)`,
                boxShadow: "0 4px 20px var(--orb-glow), inset 0 -4px 12px rgba(0,0,0,0.08), inset 0 4px 8px rgba(255,255,255,0.3)",
                animation: "orb-pulse 3s ease-in-out infinite",
              }}>
                <div style={{
                  position: "absolute",
                  top: 10,
                  left: 14,
                  width: 22,
                  height: 16,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.35)",
                  filter: "blur(6px)",
                }} />
              </div>
            </div>
            <p style={{ marginTop: 10, translate: "0 20px", maxWidth: 290, fontSize: 16, fontWeight: 500, color: "var(--text-secondary)", opacity: 0.7 }}>Everything starts with an idea. Describe the app you want to build</p>
          </div>
        )}

        {hasMessages && messages.filter((msg) =>
          msg.role !== "status"
          || msg.statusData?.type === "name-picker"
          || msg.statusData?.type === "logo-picker"
        ).map((msg) => {
          if (msg.statusData?.type === "name-picker" && msg.statusData.nameSuggestions) {
            return (
              <NamePicker
                key={msg.id}
                msgId={msg.id}
                names={msg.statusData.nameSuggestions}
                onPick={(name) => {
                  renameProject(activeId, name);
                  updateMessages(activeId, (prev) => prev.filter((m) => m.id !== msg.id));
                }}
              />
            );
          }
          if (msg.statusData?.type === "logo-picker" && msg.statusData.logoSvgs) {
            return (
              <LogoPicker
                key={msg.id}
                svgs={msg.statusData.logoSvgs}
                onPick={async (item) => {
                  try {
                    // Always render through canvas to guarantee valid PNG (Gemini may return JPEG)
                    const pngBase64 = await toPngBase64(item, 512);
                    await saveAppIcon(activeId, pngBase64);
                    // Update the project icon in state so the tab shows it immediately
                    setProjectIcon(activeId, `data:image/png;base64,${pngBase64}`);
                  } catch { /* best effort */ }
                  // Remove the picker
                  updateMessages(activeId, (prev) => prev.filter((m) => m.id !== msg.id));
                }}
              />
            );
          }
          return msg.role === "user"
            ? <UserBubble key={msg.id} content={msg.content} images={msg.images} />
            : <AiResponse key={msg.id} content={msg.content} isStreaming={msg.id === streamingId} />;
        })}
        {(thinking || (isRunning && !toolStatus && !streamingId)) && <AiResponse content="" isThinking />}
        {toolStatus && <ToolCallStatus key={toolStatus.seq} status={toolStatus} />}
        {/* Spacer pushes last message to top of viewport so user can see responses as they arrive */}
        {hasMessages && <div style={{ minHeight: "40vh" }} />}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom area */}
      <div className="px-3 pb-3" style={{ position: "relative" }}>
        <GenerationTimeline key={activeId} status={status} isRunning={isRunning} />

        <div className="rounded-2xl overflow-hidden"
          style={{
            position: "relative",
            zIndex: 2,
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
            boxShadow: "var(--input-shadow)",
          }}
        >
          <ChatInput value={inputValue} onChange={setInputValue} onSend={handleSend} isRunning={isRunning} onStop={() => cancel(activeId)} images={pendingImages} onImagesChange={setPendingImages} />
        </div>
      </div>
    </div>
  );
}
