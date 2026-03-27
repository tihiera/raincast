import { useState, useEffect, useRef } from "react";
import {
  ChevronUp, ChevronDown,
} from "lucide-react";
import { type GenerationStatus, PHASE_ORDER, PHASE_LABELS } from "../../lib/generation";
import type { ValidationLogs } from "../../lib/generation/types";

const STATUS_WORDS = [
  "Thinking", "Cooking", "Brewing", "Churning", "Crafting",
  "Conjuring", "Pondering", "Generating", "Simmering", "Forging",
  "Hatching", "Mulling", "Noodling", "Percolating", "Computing",
  "Synthesizing", "Creating", "Crunching", "Baking", "Stewing",
  "Deliberating", "Musing", "Vibing", "Ruminating", "Cogitating",
  "Manifesting", "Spinning", "Processing", "Working", "Marinating",
  "Ideating", "Transmuting", "Coalescing", "Inferring", "Assembling",
];

function ValidationLogsPanel({ logs }: { logs: ValidationLogs }) {
  const [open, setOpen] = useState(false);
  const hasStderr = logs.stderr.length > 0;
  const hasStdout = logs.stdout.length > 0;
  if (!hasStderr && !hasStdout) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 11, fontWeight: 500, color: "var(--text-secondary)",
          padding: "2px 4px",
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        {open ? "Hide" : "Show"} validation output
      </button>
      {open && (
        <pre style={{
          marginTop: 4, padding: "8px 10px", borderRadius: 6,
          background: "var(--subtle-bg)", fontSize: 10,
          lineHeight: 1.5, color: "var(--text-secondary)",
          overflow: "auto", maxHeight: 180, whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}>
          {hasStderr && logs.stderr.join("\n")}
          {hasStderr && hasStdout && "\n\n"}
          {hasStdout && logs.stdout.join("\n")}
        </pre>
      )}
    </div>
  );
}

function StepDot({ state }: { state: "done" | "active" | "pending" }) {
  const size = state === "active" ? 7 : 6;
  const bg = state === "done"
    ? "var(--text-tertiary)"
    : state === "active"
    ? "var(--text-secondary)"
    : "var(--separator-color)";

  return (
    <div style={{
      width: size, height: size, minWidth: size, minHeight: size,
      borderRadius: "50%",
      background: bg,
      flexShrink: 0,
    }} />
  );
}

interface Props {
  status: GenerationStatus;
  isRunning: boolean;
}

export default function GenerationTimeline({ status, isRunning }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * STATUS_WORDS.length));
  const [fading, setFading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % STATUS_WORDS.length);
        setFading(false);
      }, 200);
    }, 4000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning]);

  if (status.phase === "idle") return null;

  // "fixing" maps to the validating step in the timeline
  const displayPhase = status.phase === "fixing" ? "validating" : status.phase;
  const currentIdx = PHASE_ORDER.indexOf(displayPhase);
  const isFailed = status.phase === "failed";
  const isDone = status.phase === "ready";

  // Build collapsed text: rotating words while running, static for done/failed
  // No stepper counters in the compact bar — keep it clean
  let compactText: string;
  if (isFailed) {
    compactText = status.error?.title ?? "Generation Failed";
  } else if (isDone) {
    compactText = "Preview ready";
  } else {
    compactText = `${STATUS_WORDS[wordIndex]}...`;
  }

  return (
    <div style={{
      position: "relative",
      zIndex: 1,
      marginBottom: -12,
      marginLeft: 4,
      marginRight: 4,
      paddingBottom: 18,
      borderRadius: "14px 14px 0 0",
      background: "var(--pane-bg)",
      border: "1px solid var(--separator-color)",
      borderBottom: "none",
      boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
    }}>
      {/* Header bar — entire row is clickable */}
      <div
        className="flex items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
        style={{ padding: "7px 14px", cursor: "pointer" }}
      >
        <div className="flex items-center gap-1.5" style={{ overflow: "hidden" }}>
          <span
            key={expanded ? status.phase : compactText}
            style={{
              fontSize: 11.5, fontWeight: 500,
              color: isFailed ? "#c0392b" : "var(--text-secondary)",
              animation: "phase-slide-in 350ms ease-out",
              display: "inline-block",
              transition: "opacity 200ms ease",
              opacity: fading && isRunning ? 0 : 1,
            }}
          >
            {expanded
              ? (isFailed ? "Generation Failed" : isDone ? "Preview ready" : status.phase === "fixing" ? "Self-healing..." : `${STATUS_WORDS[wordIndex]}...`)
              : compactText
            }
          </span>

          {!expanded && isRunning && (
            <div style={{
              width: 12, height: 12,
              border: "1.5px solid var(--separator-color)",
              borderTopColor: "var(--slider-thumb)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {expanded
            ? <ChevronDown size={14} strokeWidth={2} style={{ color: "var(--text-tertiary)" }} />
            : <ChevronUp size={14} strokeWidth={2} style={{ color: "var(--text-tertiary)" }} />
          }
        </div>
      </div>

      {/* Expandable steps */}
      {expanded && (
        <div className="rain-scroll" style={{
          maxHeight: 220,
          overflowY: "auto",
          padding: "0 14px 4px",
        }}>
          {PHASE_ORDER.map((phase, i) => {
            const isActive = phase === displayPhase;
            const isDoneStep = currentIdx > i || isDone;
            const state = isDoneStep ? "done" : isActive ? "active" : "pending";
            const isLast = i === PHASE_ORDER.length - 1;

            let label = PHASE_LABELS[phase];
            if (phase === "generating" && status.filesDone != null && status.filesTotal != null) {
              label = `Generating files (${status.filesDone}/${status.filesTotal})`;
            }
            if (isActive && phase === "staging" && status.filesDone != null && status.filesTotal != null) {
              label = `Staging (${status.filesDone}/${status.filesTotal})`;
            }
            if (isActive && status.checkpointLabel && (phase === "staging" || phase === "checkpoint" || phase === "validating")) {
              label += ` · ${status.checkpointLabel}`;
            }
            // Show fix attempt info during validating phase when self-healing
            if (isActive && status.fixAttempt != null && status.fixMaxAttempts != null && (phase === "validating" || phase === "staging" || phase === "checkpoint")) {
              label += ` (Fix ${status.fixAttempt}/${status.fixMaxAttempts})`;
            }

            const dotSize = state === "active" ? 7 : 6;
            const isFirst = i === 0;
            // Previous step's done state for top connector color
            const prevDone = i > 0 && (currentIdx > (i - 1) || isDone);
            const topSpacerHeight = (18 - dotSize) / 2;

            return (
              <div key={phase} style={{ display: "flex", padding: "0 4px" }}>
                {/* Left: dot column stretches full row height */}
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  width: 7, flexShrink: 0,
                }}>
                  {/* Top connector: continues the line from previous row into this dot */}
                  {!isFirst ? (
                    <div style={{
                      width: 1, height: topSpacerHeight, flexShrink: 0,
                      background: prevDone ? "var(--separator-color)" : "var(--slider-track)",
                    }} />
                  ) : (
                    <div style={{ height: topSpacerHeight, flexShrink: 0 }} />
                  )}
                  <StepDot state={state} />
                  {/* Bottom connector fills remaining space */}
                  {!isLast && (
                    <div style={{
                      width: 1, flex: 1,
                      background: isDoneStep ? "var(--separator-color)" : "var(--slider-track)",
                      transition: "background 300ms ease",
                    }} />
                  )}
                </div>

                {/* Right: label + sub-content */}
                <div style={{ marginLeft: 10, flex: 1, paddingBottom: isLast ? 0 : 8 }}>
                  <span style={{
                    color: isActive ? "var(--text-primary)" : isDoneStep ? "var(--text-secondary)" : "var(--text-tertiary)",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 12,
                    lineHeight: "18px",
                    display: "block",
                  }}>
                    {label}
                  </span>

                  {isActive && status.message && (
                    <p style={{
                      fontSize: 11, color: "var(--text-tertiary)",
                      marginTop: 3, marginBottom: 0, lineHeight: "14px",
                    }}>
                      {status.message}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {isFailed && status.error && (
            <div style={{
              marginTop: 6, padding: "8px 10px", borderRadius: 8,
              background: "rgba(220, 60, 60, 0.08)", fontSize: 12,
              color: "#c0392b",
            }}>
              <strong>{status.error.title}</strong>
              {status.error.detail && <p style={{ marginTop: 2, opacity: 0.8 }}>{status.error.detail}</p>}
              {status.rolledBack && (
                <p style={{ marginTop: 4, fontSize: 11, color: "#2d8a4e", fontWeight: 500 }}>
                  Rollback complete — preview remains stable.
                </p>
              )}
            </div>
          )}

          {/* Validation logs (expandable) */}
          {isFailed && status.validationLogs && (
            <ValidationLogsPanel logs={status.validationLogs} />
          )}
        </div>
      )}
    </div>
  );
}
