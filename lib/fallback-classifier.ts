import { labelById, PROVISIONAL_VOCABULARY } from "@/lib/vocabulary";
import type { LabelHit } from "@/lib/types";

/**
 * Small on-device reader used only when the CLIP model cannot be downloaded.
 * It measures the picture (color, edges, skin-tone pixels, sky) and scores the
 * provisional vocabulary. It is a real classifier, and it is less reliable
 * than CLIP. Callers must say so in the UI. Dominant color alone is not the
 * decision.
 */
export type ImageFeatures = {
  saturation: number;
  gray: number;
  edge: number;
  vertical: number;
  skin: number;
  skinCenter: number;
  sky: number;
  green: number;
  warm: number;
  dark: number;
  contrast: number;
};

export function extractFeatures(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): ImageFeatures {
  const pixels = width * height;
  if (pixels === 0) {
    return {
      saturation: 0,
      gray: 0,
      edge: 0,
      vertical: 0,
      skin: 0,
      skinCenter: 0,
      sky: 0,
      green: 0,
      warm: 0,
      dark: 0,
      contrast: 0,
    };
  }

  let saturation = 0;
  let gray = 0;
  let skin = 0;
  let skinCenter = 0;
  let sky = 0;
  let skyCount = 0;
  let green = 0;
  let warm = 0;
  let dark = 0;
  let brightness = 0;
  let brightnessSq = 0;
  let edge = 0;
  let verticalEnergy = 0;
  let horizontalEnergy = 0;
  let centerCount = 0;

  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]] as const;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const value = max / 255;
      saturation += sat;
      brightness += value;
      brightnessSq += value * value;
      if (sat < 0.14 && value > 0.72) gray += 1;
      if (value < 0.22) dark += 1;
      if (isSkin(r, g, b)) skin += 1;
      if (g > r + 12 && g > b + 8 && sat > 0.2) green += 1;
      if (r > g + 10 && g > b && sat > 0.28 && r > 90) warm += 1;

      const inCenter =
        x > width * 0.25 &&
        x < width * 0.75 &&
        y > height * 0.18 &&
        y < height * 0.82;
      if (inCenter) {
        centerCount += 1;
        if (isSkin(r, g, b)) skinCenter += 1;
      }

      if (y < height / 3) {
        skyCount += 1;
        const blue = b > r + 12 && b > g - 8 && value > 0.35;
        if (blue) sky += 1;
      }

      if (x + 1 < width && y + 1 < height) {
        const [r2, g2, b2] = at(x + 1, y);
        const [r3, g3, b3] = at(x, y + 1);
        const gx = Math.abs(r - r2) + Math.abs(g - g2) + Math.abs(b - b2);
        const gy = Math.abs(r - r3) + Math.abs(g - g3) + Math.abs(b - b3);
        verticalEnergy += gx;
        horizontalEnergy += gy;
        edge += gx + gy > 70 ? 1 : 0;
      }
    }
  }

  const edgeTotal = verticalEnergy + horizontalEnergy;
  const mean = brightness / pixels;
  const variance = Math.max(0, brightnessSq / pixels - mean * mean);

  return {
    saturation: saturation / pixels,
    gray: gray / pixels,
    edge: edge / pixels,
    vertical: edgeTotal === 0 ? 0.5 : verticalEnergy / edgeTotal,
    skin: skin / pixels,
    skinCenter: centerCount === 0 ? 0 : skinCenter / centerCount,
    sky: skyCount === 0 ? 0 : sky / skyCount,
    green: green / pixels,
    warm: warm / pixels,
    dark: dark / pixels,
    contrast: Math.min(1, Math.sqrt(variance) * 3.2),
  };
}

function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 70 && cr > 135 && cr < 180 && cb > 85 && cb < 135 && r > g && r > b;
}

/**
 * Weights are a small linear model over the measurements above. They are
 * provisional in the same way the vocabulary is: good enough to separate
 * obviously different pictures, not a substitute for CLIP.
 */
const SCORERS: Record<string, (features: ImageFeatures) => number> = {
  screen: (f) =>
    3.1 * f.gray + 1.5 * f.edge + 0.8 * f.contrast - 2.2 * f.saturation - 1.6 * f.skin - 1.1 * f.sky,
  document: (f) =>
    2.6 * f.gray + 0.9 * f.edge - 1.5 * f.saturation - 1.2 * f.skin - 0.8 * f.warm - 0.4 * f.dark,
  portrait: (f) =>
    4.2 * f.skinCenter + 1.6 * f.skin - 1.5 * f.gray - 1.1 * f.sky - 0.6 * f.green,
  animal: (f) =>
    1.5 * f.warm +
    0.8 * f.contrast +
    0.5 * f.saturation -
    2.2 * f.skinCenter -
    1.1 * f.gray -
    0.7 * f.sky,
  food: (f) =>
    2.6 * f.warm + 1.5 * f.saturation + 0.4 * f.contrast - 1.8 * f.skin - 1.1 * f.sky - 1.2 * f.gray,
  landscape: (f) =>
    2.4 * f.sky + 1.3 * f.green + 0.4 * f.contrast - 1.6 * f.skin - 1.3 * f.gray - 0.5 * f.dark,
  architecture: (f) =>
    1.8 * f.vertical +
    1.1 * f.edge +
    0.6 * (1 - f.saturation) +
    0.4 * f.sky -
    1.4 * f.skin -
    0.8 * f.warm -
    0.7 * f.gray,
  street: (f) =>
    1.7 * f.edge +
    1.1 * f.saturation +
    0.7 * f.contrast +
    0.4 * f.dark -
    1.5 * f.gray -
    0.8 * f.skinCenter,
  plant: (f) => 3 * f.green + 0.6 * f.saturation - 1.2 * f.skin - 0.8 * f.gray,
  vehicle: (f) => 0.8 * f.edge + 0.4 * f.contrast + 0.3 * f.dark - 1.2 * f.skin - 0.6 * f.gray,
  interior: (f) => 0.7 * (1 - f.sky) + 0.4 * f.warm - 0.8 * f.gray - 0.5 * f.green,
  water: (f) => 1.6 * f.sky + 0.4 * f.saturation - 1.2 * f.skin - 0.6 * f.warm - 0.5 * f.gray,
  night: (f) => 2.4 * f.dark + 0.6 * f.contrast - 0.8 * f.gray - 0.4 * f.skin,
  crowd: (f) => 1.4 * f.skin + 0.8 * f.edge + 0.4 * f.contrast - 1.2 * f.skinCenter * 0.3 - 0.6 * f.gray,
  artwork: (f) => 0.6 * f.contrast + 0.4 * f.saturation - 0.4 * f.gray,
  sky: (f) => 2.2 * f.sky + 0.3 * (1 - f.edge) - 1.4 * f.skin - 0.8 * f.warm,
};

export function classifyFeatures(features: ImageFeatures): LabelHit {
  let bestId = PROVISIONAL_VOCABULARY[0].id;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const label of PROVISIONAL_VOCABULARY) {
    const score = SCORERS[label.id]?.(features) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestId = label.id;
    }
  }
  const label = labelById(bestId) ?? PROVISIONAL_VOCABULARY[0];
  return { id: label.id, name: label.name, score: bestScore };
}

export async function classifyBlobWithFallback(blob: Blob): Promise<LabelHit> {
  const bitmap = await createImageBitmap(blob);
  try {
    const edge = 96;
    const scale = edge / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("This file couldn't be read.");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return classifyFeatures(extractFeatures(image.data, width, height));
  } finally {
    bitmap.close();
  }
}
