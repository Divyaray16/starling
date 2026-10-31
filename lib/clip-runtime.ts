import { chooseConcept, combineFrameScores, scoresFromPromptLogits, type ConceptScore } from "@/lib/rank";
import type { LabelHit } from "@/lib/types";
import { PROMPT_TEXTS } from "@/lib/vocabulary";

export type ModelProgress = {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
};

type LogitRow = {
  data: ArrayLike<number>;
  dims?: number[];
};

type ClipPipeline = {
  tokenizer: (
    texts: string[],
    options: { padding: boolean; truncation: boolean },
  ) => Record<string, unknown>;
  processor: (images: unknown) => Promise<{ pixel_values: unknown }>;
  model: (inputs: Record<string, unknown>) => Promise<{ logits_per_image: LogitRow }>;
};

const MODEL_ID = "Xenova/clip-vit-base-patch32";

/**
 * Loads quantized CLIP. Prompt sentences are averaged per concept in
 * `rankWithClip`; they are not wrapped in an extra hypothesis template.
 */
export async function createClipClassifier(
  onProgress: (progress: ModelProgress) => void,
): Promise<ClipPipeline> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx?.wasm as { numThreads?: number } | undefined;
  if (wasm) {
    // One thread keeps the runtime off SharedArrayBuffer, so the page does
    // not need cross-origin isolation headers.
    wasm.numThreads = 1;
  }

  const classifier = await pipeline("zero-shot-image-classification", MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (update: ModelProgress) => {
      onProgress(update);
    },
  });

  return classifier as unknown as ClipPipeline;
}

function logitMatrix(logits: LogitRow): number[][] {
  const data = Array.from(logits.data, (value) => Number(value));
  const dims = logits.dims;
  if (dims && dims.length >= 2) {
    const width = dims[dims.length - 1];
    const batch = dims.slice(0, -1).reduce((product, size) => product * size, 1);
    const rows: number[][] = [];
    for (let index = 0; index < batch; index += 1) {
      rows.push(data.slice(index * width, (index + 1) * width));
    }
    return rows;
  }
  return [data];
}

/**
 * Score one or more images. Several images (a video's frames) run as a
 * batch when the model accepts it, and fall back to one image at a time.
 */
export async function scoreWithClip(classifier: ClipPipeline, blobs: Blob[]): Promise<ConceptScore[][]> {
  if (blobs.length === 0) {
    throw new Error("The model returned no label.");
  }
  const { RawImage } = await import("@huggingface/transformers");
  const images = await Promise.all(blobs.map((blob) => RawImage.read(blob)));
  const text = classifier.tokenizer([...PROMPT_TEXTS], {
    padding: true,
    truncation: true,
  });
  const { pixel_values } = await classifier.processor(images);
  const output = await classifier.model({ ...text, pixel_values });
  const rows = logitMatrix(output.logits_per_image);
  if (rows.length !== blobs.length) {
    throw new Error("The vision model returned an unexpected score layout.");
  }
  return rows.map((row) => scoresFromPromptLogits(row));
}

/** Score several files in one model pass. Each group is one file's frames. */
export async function rankGroupsWithClip(
  classifier: ClipPipeline,
  groups: Blob[][],
): Promise<LabelHit[]> {
  const usable = groups.map((group) => group.filter((blob) => blob.size > 0));
  const flat = usable.flat();
  if (flat.length === 0) {
    throw new Error("This file couldn't be read.");
  }
  let rows: ConceptScore[][];
  try {
    rows = await scoreWithClip(classifier, flat);
  } catch {
    const hits: LabelHit[] = [];
    for (const frames of usable) {
      hits.push(await rankWithClip(classifier, frames));
    }
    return hits;
  }
  let cursor = 0;
  return usable.map((frames) => {
    const slice = rows.slice(cursor, cursor + frames.length);
    cursor += frames.length;
    if (slice.length === 0) {
      throw new Error("This file couldn't be read.");
    }
    return chooseConcept(combineFrameScores(slice));
  });
}

export async function rankWithClip(classifier: ClipPipeline, blobs: Blob[]): Promise<LabelHit> {
  const frames = blobs.filter((blob) => blob.size > 0);
  if (frames.length === 0) {
    throw new Error("This file couldn't be read.");
  }

  let scored: ConceptScore[][] | null = null;
  try {
    scored = await scoreWithClip(classifier, frames);
  } catch {
    scored = [];
    for (const frame of frames) {
      try {
        const [row] = await scoreWithClip(classifier, [frame]);
        if (row) scored.push(row);
      } catch {
        // One unreadable frame is ignored when another frame scored.
      }
    }
  }

  if (!scored || scored.length === 0) {
    throw new Error("This file couldn't be read.");
  }
  return chooseConcept(combineFrameScores(scored));
}
