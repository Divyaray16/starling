import { labelByPrompt, PROVISIONAL_VOCABULARY } from "@/lib/vocabulary";
import type { LabelHit } from "@/lib/types";

export type ModelProgress = {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
};

type ZeroShot = (
  image: Blob,
  candidateLabels: string[],
  options: { hypothesis_template: string },
) => Promise<Array<{ label: string; score: number }>>;

const MODEL_ID = "Xenova/clip-vit-base-patch32";

/**
 * Loads quantized CLIP and scores an image against the provisional vocabulary.
 * Text prompts are the full sentences in that module, used verbatim.
 */
export async function createClipClassifier(
  onProgress: (progress: ModelProgress) => void,
): Promise<ZeroShot> {
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

  return classifier as ZeroShot;
}

export async function rankWithClip(classifier: ZeroShot, blob: Blob): Promise<LabelHit> {
  const prompts = PROVISIONAL_VOCABULARY.map((label) => label.prompt);
  const ranked = await classifier(blob, prompts, { hypothesis_template: "{}" });
  const top = ranked[0];
  if (!top) {
    throw new Error("The model returned no label.");
  }
  const match = labelByPrompt(top.label);
  if (!match) {
    throw new Error("The model returned an unknown label.");
  }
  return { id: match.id, name: match.name, score: top.score };
}
