"use client";

import { MediaTile } from "@/components/media-tile";
import { FLOCK_FLIGHT_MS } from "@/lib/flock";
import type { MediaKind, Point } from "@/lib/types";
import { useEffect, useRef } from "react";

function ease(t: number) {
  return 1 - Math.pow(1 - t, 3);
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
  delay,
  tilt,
  size,
  lift,
  weave,
  duration = FLOCK_FLIGHT_MS,
  onDone,
}: {
  src: string;
  name: string;
  kind: MediaKind;
  from: Point;
  to: Point;
  delay: number;
  tilt: number;
  size: number;
  lift: number;
  weave: number;
  duration?: number;
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
    const control = {
      x: from.x + (to.x - from.x) * 0.42,
      y: Math.min(from.y, to.y) - lift,
    };

    const place = (x: number, y: number, rotation: number, scale: number) => {
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      place(to.x, to.y, 0, 0.9);
      doneRef.current();
      return;
    }

    const tick = (now: number) => {
      const elapsed = now - start - delay;
      if (elapsed < 0) {
        place(from.x, from.y, tilt, 1);
        frame = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / duration);
      const eased = ease(t);
      const sway = Math.sin(eased * Math.PI) * weave;
      const x = quad(from.x, control.x, to.x, eased) + sway;
      const y = quad(from.y, control.y, to.y, eased);
      const rotation = tilt * (1 - eased) + Math.sin(eased * Math.PI) * 5;
      const scale = 1 - eased * 0.1 + Math.sin(eased * Math.PI) * 0.045;
      place(x, y, rotation, scale);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else if (!finished) {
        finished = true;
        doneRef.current();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [delay, duration, from.x, from.y, lift, tilt, to.x, to.y, weave]);

  return (
    <div
      ref={tileRef}
      data-flight
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-40 will-change-transform"
      style={{
        width: size,
        transform: `translate3d(${from.x}px, ${from.y}px, 0) translate(-50%, -50%) rotate(${tilt}deg)`,
      }}
    >
      <MediaTile src={src} name={name} kind={kind} className="w-full" />
    </div>
  );
}
