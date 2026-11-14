"use client";

import { useEffect, useMemo } from "react";

// A small burst of confetti, CSS only (no library). Each piece flies to its
// own random spot, set through CSS variables the `confetti` keyframes read.
// The parent only renders this when the person hasn't asked for reduced
// motion, and it removes itself through onDone after the animation.

const COLORS = ["#f97316", "#facc15", "#22c55e", "#0ea5e9", "#a855f7", "#ec4899"];
const PIECES = 24;

type Props = { burst: number; onDone: () => void };

// Mulberry32: a tiny seeded random generator. React wants rendering to be
// "pure" (same input, same output), which Math.random() isn't. Seeding with
// `burst` gives random-looking pieces that are still the same on a re-render.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function Confetti({ burst, onDone }: Props) {
  // `burst` changes for each new celebration, giving fresh pieces.
  const pieces = useMemo(() => {
    const random = seeded(burst);
    return Array.from({ length: PIECES }, (_, i) => {
      const angle = (i / PIECES) * Math.PI * 2 + random() * 0.4;
      const distance = 90 + random() * 110;
      return {
        dx: `${Math.cos(angle) * distance}px`,
        // A little extra drop, like gravity.
        dy: `${Math.sin(angle) * distance + 80}px`,
        spin: `${Math.round(random() * 720 - 360)}deg`,
        color: COLORS[i % COLORS.length],
        delay: `${Math.round(random() * 120)}ms`,
      };
    });
  }, [burst]);

  useEffect(() => {
    const timer = setTimeout(onDone, 1300);
    return () => clearTimeout(timer);
  }, [burst, onDone]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      {pieces.map((piece, i) => (
        <span
          key={`${burst}-${i}`}
          className="absolute size-2.5 rounded-sm motion-safe:animate-confetti"
          style={{
            backgroundColor: piece.color,
            animationDelay: piece.delay,
            ["--dx" as string]: piece.dx,
            ["--dy" as string]: piece.dy,
            ["--spin" as string]: piece.spin,
          }}
        />
      ))}
    </div>
  );
}
