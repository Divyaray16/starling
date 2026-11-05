import { createClipClassifier, rankGroupsWithClip, rankWithClip, type ModelProgress } from "@/lib/clip-runtime";

type Inbound =
  | { type: "load" }
  | { type: "classify"; requestId: number; blobs: Blob[] }
  | { type: "classify-many"; requestId: number; groups: Blob[][] };

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
    } catch {
      scope.postMessage({
        type: "model-error",
        message: "The vision model couldn’t be loaded.",
      });
    }
    return;
  }

  try {
    const classifier = await model((progress) => {
      scope.postMessage({ type: "progress", progress });
    });
    if (message.type === "classify-many") {
      const hits = await rankGroupsWithClip(classifier, message.groups);
      scope.postMessage({ type: "result-many", requestId: message.requestId, hits });
      return;
    }
    const hit = await rankWithClip(classifier, message.blobs);
    scope.postMessage({ type: "result", requestId: message.requestId, hit });
  } catch (error) {
    scope.postMessage({
      type: "file-error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "This file couldn't be read.",
    });
  }
};
