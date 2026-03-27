import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage } from "../../lib/chat/types";

interface Props {
  messages: ChatMessage[];
}

function Dot({ animate, delay = 0 }: { animate: boolean; delay?: number }) {
  return (
    <div style={{
      width: 3,
      height: 3,
      borderRadius: "50%",
      background: "var(--text-tertiary)",
      ...(animate ? {
        animation: "typing-sweep-dot 1.8s ease-in-out infinite",
        animationDelay: `${delay}s`,
      } : {}),
    }} />
  );
}

export default function StatusTicker({ messages }: Props) {
  const [queueIndex, setQueueIndex] = useState(0);
  const [showingText, setShowingText] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTextRef = useRef("");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const clearTimers = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
    if (doneTimer.current) { clearTimeout(doneTimer.current); doneTimer.current = null; }
  }, []);

  useEffect(() => {
    return clearTimers;
  }, [clearTimers]);

  useEffect(() => {
    if (queueIndex >= messages.length && messages.length > 0 && !showingText) {
      doneTimer.current = setTimeout(() => setDone(true), 500);
      return () => { if (doneTimer.current) clearTimeout(doneTimer.current); };
    }
    if (queueIndex < messages.length) {
      setDone(false);
    }
  }, [queueIndex, messages.length, showingText]);

  useEffect(() => {
    if (done || queueIndex >= messages.length) return;

    const msg = messages[queueIndex];
    const content = msg.content || msg.statusData?.label || "";

    if (!showingText) {
      if (content) {
        typingTimer.current = setTimeout(() => {
          setText(content);
          prevTextRef.current = content;
          setShowingText(true);

          holdTimer.current = setTimeout(() => {
            setShowingText(false);
            setText("");
            prevTextRef.current = "";
            setQueueIndex((i) => i + 1);
          }, 2000);
        }, 500);
      }
      return;
    }

    if (showingText && content !== prevTextRef.current && content) {
      setText(content);
      prevTextRef.current = content;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        setShowingText(false);
        setText("");
        prevTextRef.current = "";
        setQueueIndex((i) => i + 1);
      }, 2000);
    }
  }, [queueIndex, messages, showingText, done]);

  const shownMessages = messages.slice(0, queueIndex);

  if (messages.length === 0) return null;

  const isAnimating = !done;

  return (
    <div ref={containerRef} style={{ marginBottom: 6, paddingLeft: 2, position: "relative" }}>
      <div
        onClick={() => { if (done) setExpanded((v) => !v); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          border: `0.5px solid ${hovered && done ? "var(--divider-bg)" : "var(--separator-color)"}`,
          borderRadius: (showingText || expanded) ? 8 : 4,
          background: "var(--input-bg)",
          cursor: done ? "pointer" : "default",
          overflow: "hidden",
          transition: "width 300ms ease, padding 300ms ease, border-radius 300ms ease, border-color 200ms ease",
        }}
      >
        {showingText ? (
          <div style={{
            padding: "5px 12px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text-primary)",
            animation: "statusFadeIn 300ms ease",
          }}>
            {text}
            {/* Show plan tasks inline when the current message has them */}
            {(() => {
              const msg = messages[queueIndex];
              const tasks = msg?.statusData?.tasks;
              if (!tasks || tasks.length === 0) return null;
              return (
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                  {tasks.map((t, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                      • {t.description}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        ) : (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "4px 6px",
          }}>
            <Dot animate={isAnimating} delay={0} />
            <Dot animate={isAnimating} delay={0.2} />
            <Dot animate={isAnimating} delay={0.4} />
          </div>
        )}
      </div>

      {/* Expanded history floats below, doesn't push content */}
      {expanded && shownMessages.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: 4,
          padding: "5px 12px",
          borderRadius: 8,
          border: "0.5px solid var(--separator-color)",
          background: "var(--input-bg)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          animation: "statusFadeIn 200ms ease",
          zIndex: 10,
          maxWidth: 320,
        }}>
          {shownMessages.map((msg, i) => (
            <div key={msg.id || i}>
              <div style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}>
                {msg.content || msg.statusData?.label || ""}
              </div>
              {msg.statusData?.tasks && msg.statusData.tasks.length > 0 && (
                <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 1 }}>
                  {msg.statusData.tasks.map((t, j) => (
                    <div key={j} style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.55, paddingLeft: 8 }}>
                      • {t.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
