/**
 * A flock leaves as soon as it can. A small folder — the sample, or about
 * a dozen files — stays together and lifts in one burst the moment those
 * files are labeled, so they are in the air at the same time. A larger
 * folder does not sit through the rest of the classification: a handful
 * leaves as soon as they are labeled, and later tiles follow in overlapping
 * bursts. Departures are a few milliseconds apart. Each flight is under
 * about half a second.
 */
export const FLOCK_TOGETHER = 16;
export const FLOCK_READY = 4;
export const FLOCK_BURST = 16;
export const FLOCK_STAGGER_MS = 14;
export const FLOCK_FLIGHT_MIN_MS = 440;
export const FLOCK_FLIGHT_MAX_MS = 540;
/** Center of the flight range, used when a single duration is needed. */
export const FLOCK_FLIGHT_MS = 490;

export function flockReleaseCount(held: number, producerDone: boolean, total: number): number {
  if (held <= 0) return 0;
  if (producerDone) return held;
  if (total <= FLOCK_TOGETHER) return 0;
  if (held >= FLOCK_READY) return Math.min(held, FLOCK_BURST);
  return 0;
}

/** Stable flight length inside the 440–540ms range, so a flock is not a metronome. */
export function flightDuration(id: string): number {
  const span = FLOCK_FLIGHT_MAX_MS - FLOCK_FLIGHT_MIN_MS;
  return FLOCK_FLIGHT_MIN_MS + Math.round(unit(hash(id), 12) * span);
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
