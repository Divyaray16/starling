import type { HeifDecoder } from "libheif-js/wasm-bundle.js";

export type DecodedBitmap = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

type LibHeif = {
  HeifDecoder: new () => HeifDecoder;
};

let libPromise: Promise<LibHeif> | null = null;

async function loadLibHeif(): Promise<LibHeif> {
  if (!libPromise) {
    libPromise = import("libheif-js/wasm-bundle.js").then((imported) => {
      const lib = imported.default ?? (imported as unknown as LibHeif);
      if (!lib?.HeifDecoder) {
        throw new Error("The HEIC decoder didn't load.");
      }
      return lib;
    });
  }
  return libPromise;
}

/**
 * Decode one HEIC or HEIF image to 8-bit RGBA with the libheif wasm build.
 * Runs in the browser and in Node. Multi-image files yield the first image.
 * A file this decoder cannot read throws, so the caller can skip that file only.
 */
export async function decodeHeicBitmap(bytes: Uint8Array): Promise<DecodedBitmap> {
  if (bytes.byteLength < 12) {
    throw new Error("This HEIC file couldn't be decoded.");
  }
  const lib = await loadLibHeif();
  const decoder = new lib.HeifDecoder();
  let images: ReturnType<HeifDecoder["decode"]> = [];
  try {
    images = decoder.decode(bytes);
  } catch {
    throw new Error("This HEIC file couldn't be decoded.");
  }
  const image = images?.[0];
  if (!image) {
    throw new Error("This HEIC file couldn't be decoded.");
  }
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) {
    throw new Error("This HEIC file couldn't be decoded.");
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const displayed = await new Promise<Uint8ClampedArray>((resolve, reject) => {
    image.display({ data: rgba, width, height }, (result) => {
      if (!result?.data?.length) {
        reject(new Error("This HEIC file couldn't be decoded."));
        return;
      }
      resolve(new Uint8ClampedArray(result.data));
    });
  });
  return { width, height, rgba: displayed };
}
