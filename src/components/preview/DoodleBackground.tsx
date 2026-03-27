import { useState, useEffect, useCallback } from "react";
import AnimatedDoodle, { type DoodleItem } from "./AnimatedDoodle";
import DOODLE_ICONS from "./doodleIcons";

let doodleIdCounter = 0;

const INITIAL_COUNT = 60;
const SPAWN_INTERVAL = 250;

export default function DoodleBackground() {
  const [doodles, setDoodles] = useState<DoodleItem[]>([]);

  const removeDoodle = useCallback((id: number) => {
    setDoodles((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const spawnDoodle = useCallback(() => {
    const item: DoodleItem = {
      id: doodleIdCounter++,
      x: 5 + Math.random() * 90,
      y: 5 + Math.random() * 90,
      iconIdx: Math.floor(Math.random() * DOODLE_ICONS.length),
      scale: 0.9 + Math.random() * 0.8,
      rotation: Math.random() * 40 - 20,
    };
    setDoodles((prev) => [...prev, item]);
  }, []);

  useEffect(() => {
    for (let i = 0; i < INITIAL_COUNT; i++) {
      setTimeout(spawnDoodle, i * 100);
    }

    const interval = setInterval(spawnDoodle, SPAWN_INTERVAL);
    return () => clearInterval(interval);
  }, [spawnDoodle]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {doodles.map((d) => (
        <AnimatedDoodle key={d.id} item={d} onDone={removeDoodle} />
      ))}
    </div>
  );
}
