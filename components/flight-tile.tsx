"use client";

import { MediaTile } from "@/components/media-tile";
import { FLOCK_FLIGHT_MS } from "@/lib/flock";
import type { MediaKind, Point } from "@/lib/types";
import { useEffect, useRef } from "react";

/**
 * One quadratic arc from the pile to the dock. Time eases along that curve;
 * the curve itself does not kink or hook past the landing point. Motion is
 * translate3d / rotate / scale only, so the flight stays on the compositor.
 */
/** Ease-out that arrives with zero slope, so the dock does not kick. */
const EASE_X1 = 0.16;
const EASE_Y1 = 0.84;
const EASE_X2 = 0.28;
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

/** Matches MediaTile: 4px padding and a 4:5 picture. */
function tileHeight(width: number) {
  return (width - 8) * 1.25 + 8;
}

/**
 * One quadratic bow. The control point sits on the chord's midpoint, lifted
 * above it, so the path is a single smooth arc and cannot kink or hook past
 * the dock.
 */
function arcControl(from: Point, to: Point): Point {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const arc = Math.min(56, Math.max(16, dist * 0.06));
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - arc,
  };
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
  dockScale,
  layer,
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
  dockScale: number;
  layer: number;
  duration?: number;
  onDone: () => void;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  const height = tileHeight(size);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const element = tileRef.current;
    if (!element) return;
    let frame = 0;
    let finished = false;
    const start = performance.now();
    const control = arcControl(from, to);
    const halfW = size / 2;
    const halfH = height / 2;

    const place = (x: number, y: number, rotation: number, scale: number) => {
      element.style.transform = `translate3d(${x - halfW}px, ${y - halfH}px, 0) rotate(${rotation}deg) scale(${scale})`;
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      place(to.x, to.y, 0, dockScale);
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
      const eased = t >= 1 ? 1 : flightEase(t);
      const x = quad(from.x, control.x, to.x, eased);
      const y = quad(from.y, control.y, to.y, eased);
      const rotation = tilt * (1 - eased);
      const scale = 1 + (dockScale - 1) * eased;
      place(x, y, rotation, scale);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else if (!finished) {
        finished = true;
        place(to.x, to.y, 0, dockScale);
        frame = requestAnimationFrame(() => doneRef.current());
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [delay, dockScale, duration, from, height, size, tilt, to]);

  return (
    <div
      ref={tileRef}
      data-flight
      data-flight-name={name}
      aria-hidden
      className="flight-tile pointer-events-none fixed top-0 left-0"
      style={{
        width: size,
        height,
        zIndex: layer,
        transform: `translate3d(${from.x - size / 2}px, ${from.y - height / 2}px, 0) rotate(${tilt}deg) scale(1)`,
      }}
    >
      <MediaTile src={src} name={name} kind={kind} className="h-full w-full" />
    </div>
  );
}
