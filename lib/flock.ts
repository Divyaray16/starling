/**
 * The pile draws at most FLOCK_VISIBLE cards. Once the batch is ready, those
 * visible cards leave in waves of about FLOCK_WAVE: one short arc each, with
 * departures about 10ms apart. A wave lasts about 320–420ms. Files past the
 * visible cloud still land in the rows; they do not each get a flying node.
 */
export const FLOCK_STAGGER_MS = 10;
export const FLOCK_FLIGHT_MIN_MS = 320;
export const FLOCK_FLIGHT_MAX_MS = 420;
/** Center of the flight range, used when a single duration is needed. */
export const FLOCK_FLIGHT_MS = 380;
/** Cards drawn in the pile. The rest of a large batch stay in the count. */
export const FLOCK_VISIBLE = 24;
/** Flying cards in one wave. Keeps the air from stacking into one blob. */
export const FLOCK_WAVE = 12;

/**
 * How many labeled files may leave in the next wave.
 * Nothing flies before the batch is ready.
 */
export function flockReleaseCount(held: number, producerDone: boolean): number {
  if (held <= 0 || !producerDone) return 0;
  return Math.min(FLOCK_WAVE, held);
}

/** Stable flight length inside 320–420ms, tight enough that a wave arrives together. */
export function flightDuration(id: string): number {
  return 360 + Math.round(unit(hash(id), 12) * 50);
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

/**
 * Stable cloud placement. Positions come from the id, so a departure does not
 * shove the rest. Cards fill a disk (denser toward the middle) instead of a
 * hollow ring, so a couple of dozen read as one pile.
 */
export function flockLook(id: string): FlockLook {
  const h = hash(id);
  const angle = unit(h, 1) * Math.PI * 2;
  const ring = Math.sqrt(unit(h, 2));
  return {
    x: clamp(50 + Math.cos(angle) * 17 * ring, 30, 70),
    y: clamp(50 + Math.sin(angle) * 15 * ring, 32, 70),
    tilt: unit(h, 3) * 14 - 7,
    size: 70 + Math.round(unit(h, 4) * 16),
    driftX: unit(h, 5) * 6 - 3,
    driftY: unit(h, 6) * 5 - 2.5,
    duration: 3.6 + unit(h, 7) * 2.4,
    delay: -unit(h, 8) * 4.5,
    z: 1 + Math.floor(unit(h, 9) * 8),
  };
}
