"use client";

import { MediaTile } from "@/components/media-tile";
import type { MediaKind, Point } from "@/lib/types";
import { useEffect, useRef } from "react";

function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function quad(a: number, b: number, c: number, t: number) {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

export function FlightTile({
  src,
  name,
  kind,
  from,
  to,
  onDone,
}: {
  src: string;
  name: string;
  kind: MediaKind;
  from: Point;
  to: Point;
  onDone: () => void;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const element = tileRef.current;
    if (!element) return;
    let frame = 0;
    let finished = false;
    const start = performance.now();
    const duration = 720;
    const control = {
      x: (from.x + to.x) / 2,
      y: Math.min(from.y, to.y) - 92,
    };

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = ease(t);
      const x = quad(from.x, control.x, to.x, eased);
      const y = quad(from.y, control.y, to.y, eased);
      const rotation = -7 + 9 * eased;
      const lift = 1 + Math.sin(eased * Math.PI) * 0.06;
      element.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${lift})`;
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else if (!finished) {
        finished = true;
        doneRef.current();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from.x, from.y, to.x, to.y]);

  return (
    <div
      ref={tileRef}
      className="pointer-events-none fixed top-0 left-0 z-40 w-[92px] will-change-transform"
      style={{ transform: `translate3d(${from.x}px, ${from.y}px, 0)` }}
    >
      <MediaTile src={src} name={name} kind={kind} />
    </div>
  );
}
