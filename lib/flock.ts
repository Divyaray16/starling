/**
 * Every file in the batch is a card in the pile. The cards sit in one
 * overlapping cluster that grows with the batch until it fills the stage.
 * Once the batch is ready, they leave in waves of about FLOCK_WAVE: one
 * short arc each, with departures about 10ms apart. A wave lasts about
 * 320–420ms. Cards still waiting stay in the pile.
 */
export const FLOCK_STAGGER_MS = 10;
export const FLOCK_FLIGHT_MIN_MS = 320;
export const FLOCK_FLIGHT_MAX_MS = 420;
/** Center of the flight range, used when a single duration is needed. */
export const FLOCK_FLIGHT_MS = 380;
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

export type FlockLayout = {
  radiusX: number;
  radiusY: number;
  width: number;
  height: number;
  sizeMin: number;
  sizeMax: number;
};

/** Picture height inside the framed tile. Matches MediaTile's 4px padding and 4:5 image. */
export function flockTileHeight(width: number): number {
  return (width - 8) * 1.25 + 8;
}

const PREFERRED_SIZE = 78;
const MIN_SIZE = 36;
const MAX_SIZE = 112;
/** Overlap inside a compact pile. */
const PILE_LAYERS = 2.45;
/** A large batch may open until overlap is about this light, then it stops. */
const OPEN_LAYERS = 1.65;

/**
 * One cluster for the whole batch. Positions are in the pile box, which the
 * stage measures. A few cards stay a compact pile. A large batch opens until
 * it fills the field, and the cards shrink only when that is still a knot.
 */
export function flockLayout(count: number, width: number, height: number): FlockLayout {
  const n = Math.max(1, Math.round(count));
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const margin = 14;
  let size = PREFERRED_SIZE;
  let rx = 0;
  let ry = 0;

  for (let step = 0; step < 8; step += 1) {
    const cardH = flockTileHeight(size);
    const cardArea = Math.max(1, size * cardH);
    const maxRx = Math.max(8, w / 2 - size / 2 - margin);
    const maxRy = Math.max(8, h / 2 - cardH / 2 - margin);
    const aspect = maxRx / maxRy;
    const fieldArea = Math.PI * maxRx * maxRy;
    const denseArea = (n * cardArea) / PILE_LAYERS;
    // Enough cards to cover the stage should use it, instead of sitting as a
    // knot in the middle. Stop opening once the photos would lose their overlap.
    const opened = n >= 24 ? Math.min(fieldArea, (n * cardArea) / OPEN_LAYERS) : denseArea;
    const area = Math.max(denseArea, opened);
    rx = Math.sqrt((area * aspect) / Math.PI);
    ry = rx / aspect;
    if (rx <= maxRx && ry <= maxRy) break;
    const fit = Math.min(maxRx / Math.max(rx, 1), maxRy / Math.max(ry, 1));
    const next = Math.max(MIN_SIZE, size * fit);
    rx = maxRx;
    ry = maxRy;
    if (next >= size - 0.4) break;
    size = next;
  }

  const sizeMin = Math.max(MIN_SIZE - 2, Math.round(size * 0.9));
  const sizeMax = Math.min(MAX_SIZE + 6, Math.max(sizeMin, Math.round(size * 1.08)));
  const cardH = flockTileHeight(sizeMax);
  const maxRx = Math.max(0, w / 2 - sizeMax / 2 - margin);
  const maxRy = Math.max(0, h / 2 - cardH / 2 - margin);
  return {
    radiusX: Math.min(rx, maxRx),
    radiusY: Math.min(ry, maxRy),
    width: w,
    height: h,
    sizeMin,
    sizeMax,
  };
}

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

export function flockTilt(id: string): number {
  return unit(hash(id), 3) * 14 - 7;
}

/**
 * Stable place in the cluster. The id picks the spot, so a departure does
 * not shove the cards still waiting.
 */
export function flockLook(id: string, layout: FlockLayout): FlockLook {
  const h = hash(id);
  const angle = unit(h, 1) * Math.PI * 2;
  const ring = Math.sqrt(unit(h, 2));
  const span = Math.max(0, layout.sizeMax - layout.sizeMin);
  const size = layout.sizeMin + Math.round(unit(h, 4) * span);
  const cx = layout.width / 2 + Math.cos(angle) * layout.radiusX * ring;
  const cy = layout.height / 2 + Math.sin(angle) * layout.radiusY * ring;
  const x = layout.width > 0 ? (cx / layout.width) * 100 : 50;
  const y = layout.height > 0 ? (cy / layout.height) * 100 : 50;
  return {
    x,
    y,
    tilt: flockTilt(id),
    size,
    driftX: unit(h, 5) * 6 - 3,
    driftY: unit(h, 6) * 5 - 2.5,
    duration: 3.6 + unit(h, 7) * 2.4,
    delay: -unit(h, 8) * 4.5,
    z: 1 + Math.floor(unit(h, 9) * 20),
  };
}
