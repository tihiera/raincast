import { type GenerationStatus, PHASE_LABELS } from "../../lib/generation";

export default function GenerationOverlay({ status }: { status: GenerationStatus }) {
  const isActive = ["planning", "generating", "staging", "checkpoint", "validating", "investigating", "fixing"].includes(status.phase);

  if (!isActive) return null;

  const progress = status.filesDone != null && status.filesTotal != null
    ? ` (${status.filesDone}/${status.filesTotal})`
    : "";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        background: "var(--morphism-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Animated gradient blobs */}
      <div style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        borderRadius: 10,
      }}>
        <div style={{
          position: "absolute",
          width: "120%",
          height: "120%",
          top: "-10%",
          left: "-10%",
          background: "radial-gradient(ellipse at 30% 30%, var(--orb-color-3) 0%, transparent 60%), radial-gradient(ellipse at 70% 70%, var(--orb-color-1) 0%, transparent 60%)",
          opacity: 0.25,
          animation: "morphism-shift 8s ease-in-out infinite alternate",
        }} />
      </div>

      {/* Centered orb + status text */}
      <div style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <div style={{
          position: "relative",
          width: 52,
          height: 52,
          marginBottom: 16,
        }}>
          <div style={{
            position: "absolute",
            inset: -10,
            borderRadius: "50%",
            background: "var(--orb-glow)",
            filter: "blur(14px)",
            animation: "orb-pulse 3s ease-in-out infinite",
          }} />
          <div style={{
            position: "relative",
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%, var(--orb-color-3), var(--orb-color-1) 50%, var(--orb-color-2) 100%)",
            boxShadow: "0 4px 20px var(--orb-glow), inset 0 -4px 12px rgba(0,0,0,0.08), inset 0 4px 8px rgba(255,255,255,0.3)",
            animation: "orb-pulse 3s ease-in-out infinite",
          }}>
            <div style={{
              position: "absolute",
              top: 8,
              left: 12,
              width: 18,
              height: 12,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.35)",
              filter: "blur(5px)",
            }} />
          </div>
        </div>
        <p style={{
          fontSize: 16,
          fontWeight: 500,
          color: "var(--text-secondary)",
          opacity: 0.7,
          margin: 0,
        }}>
          {PHASE_LABELS[status.phase]}{progress}
        </p>
      </div>
    </div>
  );
}
