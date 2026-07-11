"use client";

import { useEffect, useState } from "react";

const PIECES = ["🎉", "🎊", "⭐", "💙", "🏆", "✨"];

interface Piece {
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  size: number;
}

function makePieces(): Piece[] {
  return Array.from({ length: 26 }, (_, i) => ({
    emoji: PIECES[i % PIECES.length],
    left: Math.random() * 100,
    delay: Math.random() * 0.25,
    duration: 1 + Math.random() * 0.6,
    size: 16 + Math.random() * 14,
  }));
}

/** A 1.6s CSS-only celebration burst — fired when a deal is recorded. */
export function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  // randomness computed ONCE, lazily — render stays pure
  const [pieces] = useState<Piece[]>(makePieces);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setGone(true);
      onDone?.();
    }, 1700);
    return () => clearTimeout(t);
  }, [onDone]);
  if (gone) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            fontSize: `${p.size}px`,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
