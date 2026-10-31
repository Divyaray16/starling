/**
 * A flock leaves together. Small and medium sets wait until every file is
 * labeled, then lift in one wave. Once 48 are waiting and more may still be
 * coming, 36 leave together and the rest stay held. The remainder of a large
 * folder leaves as its own wave. Tiles are never sent one by one as each
 * label returns.
 */
export const FLOCK_WAVE = 36;
export const FLOCK_HOLD = 48;
export const FLOCK_STAGGER_MS = 32;
export const FLOCK_FLIGHT_MS = 700;

export function flockWaveSize(held: number, producerDone: boolean): number {
  if (held <= 0) return 0;
  if (!producerDone) {
    return held >= FLOCK_HOLD ? FLOCK_WAVE : 0;
  }
  if (held > FLOCK_HOLD) return FLOCK_WAVE;
  return held;
}

export type FlockLook = {
  x: number;
  y: number;
  tilt: number;
  size: number;
  driftX: number;
  driftY: number;
  duration: number;
  delay: number;
  z: number;
};

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(h: number, salt: number): number {
  const mixed = Math.imul(h ^ salt, 0x6d2b79f5);
  return ((mixed >>> 0) % 10000) / 10000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Stable cloud placement. Positions come from the id, so a departure does not shove the rest. */
export function flockLook(id: string): FlockLook {
  const h = hash(id);
  const angle = unit(h, 1) * Math.PI * 2;
  const ring = 0.55 + unit(h, 2) * 0.45;
  return {
    x: clamp(50 + Math.cos(angle) * 22 * ring, 28, 72),
    y: clamp(48 + Math.sin(angle) * 18 * ring, 30, 70),
    tilt: unit(h, 3) * 18 - 9,
    size: 72 + Math.round(unit(h, 4) * 16),
    driftX: unit(h, 5) * 14 - 7,
    driftY: unit(h, 6) * 12 - 6,
    duration: 3.6 + unit(h, 7) * 2.4,
    delay: -unit(h, 8) * 4.5,
    z: 1 + Math.floor(unit(h, 9) * 6),
  };
}
