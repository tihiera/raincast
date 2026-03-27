import { useState, useEffect } from "react";
import DOODLE_ICONS from "./doodleIcons";

export interface DoodleItem {
  id: number;
  x: number;
  y: number;
  iconIdx: number;
  scale: number;
  rotation: number;
}

export default function AnimatedDoodle({ item, onDone }: { item: DoodleItem; onDone: (id: number) => void }) {
  const [phase, setPhase] = useState<"in" | "visible" | "out">("in");

  useEffect(() => {
    const visibleTimer = setTimeout(() => setPhase("visible"), 800);
    const stayDuration = 3000 + Math.random() * 2000;
    const outTimer = setTimeout(() => setPhase("out"), 800 + stayDuration);
    const removeTimer = setTimeout(() => onDone(item.id), 800 + stayDuration + 800);

    return () => {
      clearTimeout(visibleTimer);
      clearTimeout(outTimer);
      clearTimeout(removeTimer);
    };
  }, [item.id, onDone]);

  const opacity = phase === "in" ? 0 : phase === "visible" ? 1 : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: `${item.x}%`,
        top: `${item.y}%`,
        opacity,
        transition: "opacity 800ms ease",
        transform: `scale(${item.scale}) rotate(${item.rotation}deg)`,
        pointerEvents: "none",
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--text-tertiary)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.35 }}
        dangerouslySetInnerHTML={{ __html: DOODLE_ICONS[item.iconIdx] }}
      />
    </div>
  );
}
