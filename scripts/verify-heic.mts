import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeHeicBitmap } from "../lib/heic.ts";
import { mediaKind, partitionFiles } from "../lib/intake.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function coloredPixels(rgba: Uint8ClampedArray): number {
  let colored = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] !== 0 || rgba[i + 1] !== 0 || rgba[i + 2] !== 0) colored += 1;
  }
  return colored;
}

async function expectBitmap(name: string) {
  const bytes = new Uint8Array(readFileSync(resolve(root, "fixtures", name)));
  const bitmap = await decodeHeicBitmap(bytes);
  const colored = coloredPixels(bitmap.rgba);
  const pixels = bitmap.width * bitmap.height;
  if (bitmap.width < 2 || bitmap.height < 2) {
    throw new Error(`${name} decoded to empty dimensions`);
  }
  if (bitmap.rgba.length !== pixels * 4) {
    throw new Error(`${name} rgba length ${bitmap.rgba.length} does not match ${pixels}`);
  }
  if (colored < pixels * 0.5) {
    throw new Error(`${name} bitmap is mostly empty (${colored}/${pixels} colored)`);
  }
  console.log(`${name} ${bitmap.width}x${bitmap.height} colored=${colored}/${pixels}`);
}

await expectBitmap("food.heic");
await expectBitmap("portrait.heif");

let rejected = false;
try {
  await decodeHeicBitmap(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
} catch {
  rejected = true;
}
if (!rejected) {
  throw new Error("A truncated HEIC should fail decode instead of returning a bitmap");
}
console.log("truncated HEIC rejected");

const heic = new File([readFileSync(resolve(root, "fixtures/food.heic"))], "food.heic", {
  type: "image/heic",
});
const heif = new File([readFileSync(resolve(root, "fixtures/portrait.heif"))], "portrait.heif", {
  type: "image/heif",
});
const jpeg = new File([new Uint8Array([1, 2, 3])], "still.jpg", { type: "image/jpeg" });
const notes = new File(["hello"], "notes.txt", { type: "text/plain" });
const partition = partitionFiles([heic, heif, jpeg, notes]);
if (partition.supported.length !== 3 || partition.skipped !== 1) {
  throw new Error(
    `HEIC/HEIF were not kept for classification: ${JSON.stringify({ supported: partition.supported.map((file) => file.name), skipped: partition.skipped })}`,
  );
}
if (mediaKind(heic) !== "heic" || mediaKind(heif) !== "heic") {
  throw new Error("HEIC and HEIF should be recognized as decodable stills");
}
console.log("partition keeps HEIC and HEIF, skips notes.txt");
