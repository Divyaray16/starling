"use client";

import { MediaTile } from "@/components/media-tile";
import { FLOCK_FLIGHT_MS } from "@/lib/flock";
import type { MediaKind, Point } from "@/lib/types";
import { useEffect, useRef } from "react";

/**
 * Custom cubic-bezier(0.22, 0.82, 0.18, 1): a quick lift off the pile and a
 * soft settle into the row. Not a linear slide.
 */
const EASE_X1 = 0.22;
const EASE_Y1 = 0.82;
const EASE_X2 = 0.18;
const EASE_Y2 = 1;

function cubicBezier(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let step = 0; step < 6; step += 1) {
    const slope = sampleDX(u);
    if (Math.abs(slope) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - (sampleX(u) - t) / slope));
  }
  return sampleY(u);
}

function flightEase(t: number) {
  return cubicBezier(t, EASE_X1, EASE_Y1, EASE_X2, EASE_Y2);
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
      x: (from.x + to.x) / 2 + weave,
      y: Math.min(from.y, to.y) - lift,
    };

    const place = (x: number, y: number, rotation: number, scale: number) => {
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      place(to.x, to.y, 0, 0.92);
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
      const eased = flightEase(t);
      const x = quad(from.x, control.x, to.x, eased);
      const y = quad(from.y, control.y, to.y, eased);
      const along = Math.sin(eased * Math.PI);
      const rotation = tilt * (1 - eased) + along * (weave >= 0 ? 8 : -8);
      // A small breath in the air, then a slight scale settle as it docks.
      const scale = 1 - eased * 0.08 + along * 0.055;
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
