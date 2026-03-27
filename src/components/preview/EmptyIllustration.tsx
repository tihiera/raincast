import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";

// Bodies
import Tee from "@opeepsfun/open-peeps/build/body/effigy/Tee";
import Hoodie from "@opeepsfun/open-peeps/build/body/effigy/Hoodie";
import Dress from "@opeepsfun/open-peeps/build/body/effigy/Dress";
import Jacket from "@opeepsfun/open-peeps/build/body/effigy/Jacket";
import ButtonShirt from "@opeepsfun/open-peeps/build/body/effigy/ButtonShirt";
import Turtleneck from "@opeepsfun/open-peeps/build/body/effigy/Turtleneck";
import PoloSweater from "@opeepsfun/open-peeps/build/body/effigy/PoloSweater";
import StripedTee from "@opeepsfun/open-peeps/build/body/effigy/StripedTee";
import SweaterDots from "@opeepsfun/open-peeps/build/body/effigy/SweaterDots";
import ThunderTee from "@opeepsfun/open-peeps/build/body/effigy/ThunderTee";
import SportyTee from "@opeepsfun/open-peeps/build/body/effigy/SportyTee";
import GymShirt from "@opeepsfun/open-peeps/build/body/effigy/GymShirt";

// Heads (with their required offset transforms from Effigy.js)
import LongBangs from "@opeepsfun/open-peeps/build/head/LongBangs";
import Bun from "@opeepsfun/open-peeps/build/head/Bun";
import ShortOne from "@opeepsfun/open-peeps/build/head/ShortOne";
import Bangs from "@opeepsfun/open-peeps/build/head/Bangs";
import MediumStraight from "@opeepsfun/open-peeps/build/head/MediumStraight";
import Afro from "@opeepsfun/open-peeps/build/head/Afro";
import Wavy from "@opeepsfun/open-peeps/build/head/Wavy";
import BunTwo from "@opeepsfun/open-peeps/build/head/BunTwo";
import LongCurly from "@opeepsfun/open-peeps/build/head/LongCurly";
import Pomp from "@opeepsfun/open-peeps/build/head/Pomp";
import ShortTwo from "@opeepsfun/open-peeps/build/head/ShortTwo";
import MediumTwo from "@opeepsfun/open-peeps/build/head/MediumTwo";
import LongHair from "@opeepsfun/open-peeps/build/head/LongHair";
import Mohawk from "@opeepsfun/open-peeps/build/head/Mohawk";
import DreadsTwo from "@opeepsfun/open-peeps/build/head/DreadsTwo";
import Beanie from "@opeepsfun/open-peeps/build/head/Beanie";
import HatHip from "@opeepsfun/open-peeps/build/head/HatHip";
import BunClip from "@opeepsfun/open-peeps/build/head/BunClip";

// Faces
import Cute from "@opeepsfun/open-peeps/build/face/Cute";
import Calm from "@opeepsfun/open-peeps/build/face/Calm";
import BigSmile from "@opeepsfun/open-peeps/build/face/BigSmile";
import Cheeky from "@opeepsfun/open-peeps/build/face/Cheeky";
import Awe from "@opeepsfun/open-peeps/build/face/Awe";
import EyesClosed from "@opeepsfun/open-peeps/build/face/EyesClosed";
import Smile from "@opeepsfun/open-peeps/build/face/Smile";
import SmileTeeth from "@opeepsfun/open-peeps/build/face/SmileTeeth";
import Explaining from "@opeepsfun/open-peeps/build/face/Explaining";
import Solemn from "@opeepsfun/open-peeps/build/face/Solemn";

const OUTLINE = "var(--peep-outline)";
const SKIN = "transparent";
const TOP = "transparent";

const BODIES = [Tee, Hoodie, Dress, Jacket, ButtonShirt, Turtleneck, PoloSweater, StripedTee, SweaterDots, ThunderTee, SportyTee, GymShirt];

const HEADS: Array<[any, string]> = [
  [LongBangs,      "translate(-25 0)"],
  [Bun,            "translate(-20 -30)"],
  [ShortOne,       "translate(40 -10)"],
  [Bangs,          ""],
  [MediumStraight, "translate(40 0)"],
  [Afro,           ""],
  [Wavy,           "translate(40 0)"],
  [BunTwo,         "translate(-50 -90)"],
  [LongCurly,      "translate(-50 -40)"],
  [Pomp,           "translate(40 0)"],
  [ShortTwo,       "translate(40 0)"],
  [MediumTwo,      "translate(-20 0)"],
  [LongHair,       "translate(-50 0)"],
  [Mohawk,         "translate(40 0)"],
  [DreadsTwo,      "translate(0 -15)"],
  [Beanie,         "translate(20 0)"],
  [HatHip,         "translate(-30 0)"],
  [BunClip,        "translate(20 -70)"],
];

const FACES = [Cute, Calm, BigSmile, Cheeky, Awe, EyesClosed, Smile, SmileTeeth, Explaining, Solemn];

function pickRandom<T>(arr: T[], recentIndices: number[]): [T, number] {
  const available = arr.map((_, i) => i).filter((i) => !recentIndices.includes(i));
  const pool = available.length > 0 ? available : arr.map((_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return [arr[idx], idx];
}

interface Combo {
  Body: any;
  Head: any;
  headTransform: string;
  Face: any;
  key: string;
}

const FADE_MS = 400;

function PeepSvg({ combo, onMeasured }: { combo: Combo; onMeasured?: (vb: string) => void }) {
  const groupRef = useRef<SVGGElement>(null);
  const [viewBox, setViewBox] = useState("0 0 1000 1200");
  const { Body, Head, headTransform, Face } = combo;

  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const bbox = g.getBBox();
    const pad = 20;
    const vb = `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`;
    setViewBox(vb);
    onMeasured?.(vb);
  }, [combo, onMeasured]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width="200"
      height="240"
      style={{ display: "block" }}
    >
      <g ref={groupRef}>
        <g transform="translate(147, 639)">
          <g className="peep-breathe">
            <Body skinColor={SKIN} topColor={TOP} outlineColor={OUTLINE} />
          </g>
        </g>
        <g className="peep-head">
          <g transform="translate(342, 190)">
            <g transform={headTransform}>
              <Head outlineColor={OUTLINE} skinColor={SKIN} />
            </g>
          </g>
          <g transform="translate(531, 366)">
            <g className="peep-face">
              <Face outlineColor={OUTLINE} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

export default function EmptyIllustration() {
  const recentBodies = useRef<number[]>([]);
  const recentHeads = useRef<number[]>([]);
  const recentFaces = useRef<number[]>([]);

  const generate = useCallback((): Combo => {
    const [Body, bi] = pickRandom(BODIES, recentBodies.current);
    const [[Head, headTransform], hi] = pickRandom(HEADS, recentHeads.current);
    const [Face, fi] = pickRandom(FACES, recentFaces.current);

    recentBodies.current = [...recentBodies.current, bi].slice(-7);
    recentHeads.current = [...recentHeads.current, hi].slice(-7);
    recentFaces.current = [...recentFaces.current, fi].slice(-7);

    return { Body, Head, headTransform, Face, key: `${bi}-${hi}-${fi}` };
  }, []);

  const [current, setCurrent] = useState<Combo>(generate);
  const [next, setNext] = useState<Combo | null>(null);
  const [phase, setPhase] = useState<"visible" | "fading-out" | "fading-in">("visible");

  useEffect(() => {
    const id = setInterval(() => {
      // Start the transition: generate next combo and fade out current
      const nextCombo = generate();
      setNext(nextCombo);
      setPhase("fading-out");
    }, 10000);
    return () => clearInterval(id);
  }, [generate]);

  // When fading-out completes, swap and fade in
  useEffect(() => {
    if (phase === "fading-out") {
      const timer = setTimeout(() => {
        if (next) {
          setCurrent(next);
          setNext(null);
        }
        setPhase("fading-in");
      }, FADE_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "fading-in") {
      const timer = setTimeout(() => {
        setPhase("visible");
      }, FADE_MS);
      return () => clearTimeout(timer);
    }
  }, [phase, next]);

  const opacity =
    phase === "fading-out" ? 0
    : phase === "fading-in" ? 0.45
    : 0.45;

  return (
    <div
      style={{
        opacity,
        transition: `opacity ${FADE_MS}ms ease`,
        animation: "peep-float 4s ease-in-out infinite",
      }}
    >
      <PeepSvg combo={current} />
    </div>
  );
}
