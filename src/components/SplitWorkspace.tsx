import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";

const STORAGE_KEY = "raincast-split-ratio";
const DEFAULT_RATIO = 0.7;
const MIN_RATIO = 0.6;   // chat max 40%
const MAX_RATIO = 0.75;  // chat min 25%

interface Props {
  left: ReactNode;
  right: ReactNode;
}

export default function SplitWorkspace({ left, right }: Props) {
  const [ratio, setRatio] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Math.max(MIN_RATIO, Math.min(MAX_RATIO, Number(saved))) : DEFAULT_RATIO;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, x / rect.width));
    setRatio(newRatio);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(ratio));
  }, [ratio]);

  return (
    <div
      ref={containerRef}
      className="flex flex-1 min-h-0 gap-0 px-1.5 pb-1.5"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Left panel */}
      <div style={{ width: `${ratio * 100}%`, transition: "width 100ms ease-in-out" }} className="min-w-0">
        {left}
      </div>

      {/* Divider */}
      <div
        onPointerDown={onPointerDown}
        className="w-1.5 shrink-0 flex items-center justify-center cursor-col-resize group"
      >
        <div className="w-[3px] h-10 rounded-full transition-colors" style={{ background: "var(--divider-bg)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--divider-hover-bg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--divider-bg)"; }}
        />
      </div>

      {/* Right panel */}
      <div style={{ width: `${(1 - ratio) * 100}%`, transition: "width 100ms ease-in-out" }} className="min-w-0">
        {right}
      </div>
    </div>
  );
}
