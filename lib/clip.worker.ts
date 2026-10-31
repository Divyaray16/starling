import { createClipClassifier, rankWithClip, type ModelProgress } from "@/lib/clip-runtime";

type Inbound =
  | { type: "load" }
  | { type: "classify"; requestId: number; blob: Blob };

type Classifier = Awaited<ReturnType<typeof createClipClassifier>>;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Inbound>) => void) | null;
  postMessage: (message: unknown) => void;
};

let classifierPromise: Promise<Classifier> | null = null;

function model(onProgress: (progress: ModelProgress) => void) {
  if (!classifierPromise) {
    classifierPromise = createClipClassifier(onProgress).catch((error) => {
      classifierPromise = null;
      throw error;
    });
  }
  return classifierPromise;
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "load") {
    try {
      await model((progress) => {
        scope.postMessage({ type: "progress", progress });
      });
      scope.postMessage({ type: "ready" });
    } catch (error) {
      scope.postMessage({
        type: "model-error",
        message: error instanceof Error ? error.message : "The vision model failed to load.",
      });
    }
    return;
  }

  try {
    const classifier = await model((progress) => {
      scope.postMessage({ type: "progress", progress });
    });
    const hit = await rankWithClip(classifier, message.blob);
    scope.postMessage({ type: "result", requestId: message.requestId, hit });
  } catch (error) {
    scope.postMessage({
      type: "file-error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "This file couldn't be read.",
    });
  }
};
