/**
 * Every file in the batch is a card in the pile. The cards share one size and
 * sit in one rounded cluster: a golden-angle spiral inside an ellipse at the
 * middle of the pile box. Place 0 is the center. Place i is at angle i·φ and
 * at radius (i / (n−1))^0.66, so the middle is denser, the center is occupied,
 * and the outer cards stay on the same spiral. The ellipse grows with the
 * batch and, near 65 cards, uses most of the box while stopping short of the
 * edges by the card itself, a 7° tilt, and a margin. The card width is the
 * largest size that still keeps neighboring centers about half a card apart,
 * so the pile does not collapse into a knot or scatter. A handful of cards
 * stays compact; the ellipse is pulled back in when they would otherwise
 * spread across the field.
 *
 * Once the batch is ready, cards leave in waves of about FLOCK_WAVE: one
 * short arc each, with departures about 10ms apart. A wave lasts about
 * 320–420ms. Cards still waiting keep the places they were given.
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
  size: number;
  count: number;
};

/** Picture height inside the framed tile. Matches MediaTile's 4px padding and 4:5 image. */
export function flockTileHeight(width: number): number {
  return (width - 8) * 1.25 + 8;
}

const PREFERRED_MIN = 44;
const PREFERRED_MAX = 112;
/** Gap from the pile box to a card's rotated body. */
const EDGE = 16;
/** Radius power above 1/2 packs the middle without opening a hole. */
const CENTER_WEIGHT = 0.66;
/** Neighboring centers stay at least this fraction of a card width apart. */
const MIN_GAP_RATIO = 0.4;
/** Looser than this, a small batch is pulled back into a pile. */
const LOOSE_GAP_RATIO = 0.56;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

type Point = { x: number; y: number };

/**
 * How much of the inset field the cluster wants. A single card stays put.
 * Around 65 cards the pile fills the field; past that it stops growing and
 * the cards shrink instead.
 */
function fieldFill(count: number): number {
  if (count <= 1) return 0;
  const t = Math.min(1, count / 65);
  return 0.36 + 0.56 * Math.pow(t, 0.62);
}

function rotatedHalf(size: number): { hx: number; hy: number } {
  const cardH = flockTileHeight(size);
  const rad = (7 * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    hx: (size * c + cardH * s) / 2,
    hy: (size * s + cardH * c) / 2,
  };
}

let cachedCount = -1;
let cachedPoints: Point[] = [];

/** Unit-circle spiral, center first. Screen space stretches it into the ellipse. */
export function flockPoints(count: number): Point[] {
  const n = Math.max(1, Math.round(count));
  if (n === cachedCount) return cachedPoints;
  const points: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const along = n <= 1 ? 0 : i / (n - 1);
    const radius = Math.pow(along, CENTER_WEIGHT);
    const angle = i * GOLDEN_ANGLE;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  cachedCount = n;
  cachedPoints = points;
  return points;
}

function medianGap(points: Point[], rx: number, ry: number): number {
  const n = points.length;
  if (n <= 1) return 0;
  const gaps = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const ix = points[i].x * rx;
    const iy = points[i].y * ry;
    let best = Infinity;
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const dx = ix - points[j].x * rx;
      const dy = iy - points[j].y * ry;
      const dist = dx * dx + dy * dy;
      if (dist < best) best = dist;
    }
    gaps[i] = Math.sqrt(best);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(n / 2)];
}

function fieldAt(size: number, width: number, height: number): { maxRx: number; maxRy: number } {
  const { hx, hy } = rotatedHalf(size);
  return {
    maxRx: Math.max(0, width / 2 - hx - EDGE),
    maxRy: Math.max(0, height / 2 - hy - EDGE),
  };
}

/**
 * One cluster for the whole batch. Positions are in the pile box, which the
 * stage measures before any card is placed.
 */
export function flockLayout(count: number, width: number, height: number): FlockLayout {
  const n = Math.max(1, Math.round(count));
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const points = flockPoints(n);
  const fill = fieldFill(n);

  let chosenSize = PREFERRED_MIN;
  let chosenRx = 0;
  let chosenRy = 0;

  for (let size = PREFERRED_MAX; size >= PREFERRED_MIN; size -= 1) {
    const { maxRx, maxRy } = fieldAt(size, w, h);
    if (n <= 1) {
      if (maxRx > 0 && maxRy > 0) {
        chosenSize = size;
        chosenRx = 0;
        chosenRy = 0;
        break;
      }
      continue;
    }
    let used = fill;
    let rx = maxRx * used;
    let ry = maxRy * used;
    let ratio = medianGap(points, rx, ry) / size;
    if (ratio > LOOSE_GAP_RATIO && fill > 0) {
      const minFill = n >= 48 ? Math.min(fill, Math.max(0.78, fill * 0.86)) : Math.min(fill, 0.3);
      const scaled = fill * (0.5 / ratio);
      used = Math.min(fill, Math.max(minFill, scaled));
      rx = maxRx * used;
      ry = maxRy * used;
      ratio = medianGap(points, rx, ry) / size;
    }
    chosenSize = size;
    chosenRx = rx;
    chosenRy = ry;
    if (ratio >= MIN_GAP_RATIO) break;
  }

  return {
    radiusX: chosenRx,
    radiusY: chosenRy,
    width: w,
    height: h,
    size: chosenSize,
    count: n,
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
 * Stable place in the cluster. `slot` is the file's place in the spiral and
 * does not change when another card leaves, so the ones still waiting stay put.
 */
export function flockLook(id: string, slot: number, layout: FlockLayout): FlockLook {
  const h = hash(id);
  const points = flockPoints(layout.count);
  const index = Math.min(points.length - 1, Math.max(0, Math.round(slot)));
  const point = points[index] ?? { x: 0, y: 0 };
  const cx = layout.width / 2 + point.x * layout.radiusX;
  const cy = layout.height / 2 + point.y * layout.radiusY;
  const x = layout.width > 0 ? (cx / layout.width) * 100 : 50;
  const y = layout.height > 0 ? (cy / layout.height) * 100 : 50;
  const radial = Math.min(1, Math.hypot(point.x, point.y));
  return {
    x,
    y,
    tilt: flockTilt(id),
    size: layout.size,
    driftX: unit(h, 5) * 6 - 3,
    driftY: unit(h, 6) * 5 - 2.5,
    duration: 3.6 + unit(h, 7) * 2.4,
    delay: -unit(h, 8) * 4.5,
    z: 10 + Math.floor(unit(h, 9) * 36) + Math.round((1 - radial) * 14),
  };
}
