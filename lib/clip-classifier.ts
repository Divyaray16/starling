import { createClipClassifier, rankWithClip, type ModelProgress } from "@/lib/clip-runtime";
import type { LabelHit } from "@/lib/types";

type WorkerResponse =
  | { type: "progress"; progress: ModelProgress }
  | { type: "ready" }
  | { type: "model-error"; message: string }
  | { type: "result"; requestId: number; hit: LabelHit }
  | { type: "file-error"; requestId: number; message: string };

type Pending = {
  resolve: (hit: LabelHit) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let workerBootFailed = false;
let useMainThread = false;
let mainClassifier: Awaited<ReturnType<typeof createClipClassifier>> | null = null;
let progressListener: (progress: ModelProgress) => void = () => {};
let requestId = 0;
const pending = new Map<number, Pending>();
let readyPromise: Promise<void> | null = null;
let readyResolve: (() => void) | null = null;
let readyReject: ((error: Error) => void) | null = null;

export function onModelProgress(listener: (progress: ModelProgress) => void) {
  progressListener = listener;
}

export function isModelRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /onnx|wasm|session|model|network|fetch|out of memory|webgpu/i.test(message);
}

function bootWorker(): Worker | null {
  if (worker || workerBootFailed || typeof window === "undefined") return worker;
  try {
    worker = new Worker(new URL("./clip.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBootFailed = true;
    return null;
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "progress") {
      progressListener(message.progress);
      return;
    }
    if (message.type === "ready") {
      readyResolve?.();
      return;
    }
    if (message.type === "model-error") {
      readyReject?.(new Error(message.message));
      return;
    }
    const waiter = pending.get(message.requestId);
    if (!waiter) return;
    pending.delete(message.requestId);
    if (message.type === "result") waiter.resolve(message.hit);
    else waiter.reject(new Error(message.message));
  };

  worker.onerror = () => {
    workerBootFailed = true;
    worker?.terminate();
    worker = null;
    readyReject?.(new Error("The vision model worker failed to start."));
  };

  return worker;
}

async function ensureMainClassifier() {
  if (!mainClassifier) {
    mainClassifier = await createClipClassifier((progress) => progressListener(progress));
  }
  return mainClassifier;
}

export async function loadClipModel(): Promise<void> {
  if (useMainThread) {
    await ensureMainClassifier();
    return;
  }

  const instance = bootWorker();
  if (!instance) {
    useMainThread = true;
    await ensureMainClassifier();
    return;
  }

  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    instance.postMessage({ type: "load" });
  }

  try {
    await readyPromise;
  } catch (error) {
    readyPromise = null;
    if (workerBootFailed) {
      useMainThread = true;
      await ensureMainClassifier();
      return;
    }
    throw error;
  }
}

export async function classifyWithClip(blob: Blob): Promise<LabelHit> {
  if (useMainThread) {
    const classifier = await ensureMainClassifier();
    return rankWithClip(classifier, blob);
  }

  const instance = bootWorker();
  if (!instance) {
    useMainThread = true;
    const classifier = await ensureMainClassifier();
    return rankWithClip(classifier, blob);
  }

  const id = ++requestId;
  return new Promise<LabelHit>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    instance.postMessage({ type: "classify", requestId: id, blob });
  });
}

export function stopClipWorker() {
  worker?.terminate();
  worker = null;
  readyPromise = null;
  pending.forEach((waiter) => waiter.reject(new Error("Sorting was cancelled.")));
  pending.clear();
}
