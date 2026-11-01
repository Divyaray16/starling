import { decodeHeicBitmap } from "./heic";
import type { MediaKind, QueueItem } from "./types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const HEIC_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export type FolderRead = {
  folderName: string;
  files: File[];
};

export type Partition = {
  supported: File[];
  skipped: number;
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function mediaKind(file: File): MediaKind | "heic" | "skip" {
  const extension = extensionOf(file.name);
  const type = file.type.toLowerCase();
  if (HEIC_EXTENSIONS.has(extension) || HEIC_TYPES.has(type)) {
    return "heic";
  }
  if (IMAGE_EXTENSIONS.has(extension) || ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) {
    return "photo";
  }
  if (
    VIDEO_EXTENSIONS.has(extension) ||
    type === "video/mp4" ||
    type === "video/webm" ||
    type === "video/quicktime"
  ) {
    return "video";
  }
  return "skip";
}

export function partitionFiles(files: File[]): Partition {
  const supported: File[] = [];
  let skipped = 0;
  for (const file of files) {
    if (file.name.startsWith(".")) continue;
    const kind = mediaKind(file);
    if (kind === "photo" || kind === "video" || kind === "heic") supported.push(file);
    else if (file.size > 0 || extensionOf(file.name)) skipped += 1;
  }
  return { supported, skipped };
}

/** Same name, size, and lastModified are the same file for this session. */
export function fileIdentity(file: Pick<File, "name" | "size" | "lastModified">): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/**
 * Files in this pick that are not already in the session, and not repeated
 * inside the pick itself. Does not record them; callers remember only the
 * files they actually accept.
 */
export function takeNewFiles<T extends Pick<File, "name" | "size" | "lastModified">>(
  files: T[],
  seen: ReadonlySet<string>,
): T[] {
  const fresh: T[] = [];
  const batch = new Set<string>();
  for (const file of files) {
    const key = fileIdentity(file);
    if (seen.has(key) || batch.has(key)) continue;
    batch.add(key);
    fresh.push(file);
  }
  return fresh;
}

export function rememberFiles(
  files: Array<Pick<File, "name" | "size" | "lastModified">>,
  seen: Set<string>,
) {
  for (const file of files) seen.add(fileIdentity(file));
}

export async function prepareQueueItem(file: File): Promise<QueueItem> {
  const kind = mediaKind(file);
  if (kind === "video") {
    const frames = await captureVideoFrames(file);
    const thumb = frames[Math.min(frames.length - 1, Math.floor(frames.length / 2))] ?? frames[0];
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "video",
      thumbUrl: URL.createObjectURL(thumb),
      classifyFrames: frames,
      file,
    };
  }
  if (kind === "heic") {
    const still = await heicFileToJpeg(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "photo",
      thumbUrl: URL.createObjectURL(still),
      classifyFrames: [still],
      file,
    };
  }
  if (kind !== "photo") {
    throw new Error("Unsupported file.");
  }
  const still = await downscalePhoto(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    kind: "photo",
    thumbUrl: URL.createObjectURL(still),
    classifyFrames: [still],
    file,
  };
}

async function heicFileToJpeg(file: File): Promise<Blob> {
  const decoded = await decodeHeicBitmap(new Uint8Array(await file.arrayBuffer()));
  const pixels = new Uint8ClampedArray(decoded.rgba);
  const bitmap = await createImageBitmap(new ImageData(pixels, decoded.width, decoded.height));
  try {
    return await canvasJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function downscalePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return await canvasJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

function canvasJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const maxEdge = 720;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This file couldn't be read.");
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("This file couldn't be read."));
        else resolve(blob);
      },
      "image/jpeg",
      0.86,
    );
  });
}

/**
 * Sample times for a video. Three frames — start, middle, end — when the
 * clip is long enough for them to be distinct. Shorter clips use fewer.
 */
export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration < 0.2) return [0];
  const clamp = (time: number) => Math.min(Math.max(0, time), Math.max(0, duration - 0.04));
  const start = clamp(Math.min(0.1, duration * 0.08));
  const middle = clamp(duration * 0.5);
  const end = clamp(duration * 0.92);
  const distinct: number[] = [];
  for (const time of [start, middle, end]) {
    if (distinct.every((kept) => Math.abs(kept - time) >= 0.12)) distinct.push(time);
  }
  return distinct.length > 0 ? distinct : [middle];
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("This video couldn't be read."));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error("This video couldn't be read."));
    }
  });
}

export function captureVideoFrames(file: File): Promise<Blob[]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      action();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("This video couldn't be read.")));
    }, 12000);

    const draw = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        throw new Error("This video couldn't be read.");
      }
      return canvasJpeg(video, width, height);
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener(
      "error",
      () => finish(() => reject(new Error("This video couldn't be read."))),
      { once: true },
    );
    video.addEventListener(
      "loadeddata",
      () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const times = videoSampleTimes(duration);
        const frames: Blob[] = [];
        const next = (index: number) => {
          if (settled) return;
          if (index >= times.length) {
            if (frames.length === 0) {
              finish(() => reject(new Error("This video couldn't be read.")));
              return;
            }
            finish(() => resolve(frames));
            return;
          }
          seekVideo(video, times[index]).then(
            () =>
              draw().then(
                (blob) => {
                  frames.push(blob);
                  next(index + 1);
                },
                () => {
                  if (frames.length === 0 && index === times.length - 1) {
                    finish(() => reject(new Error("This video couldn't be read.")));
                    return;
                  }
                  next(index + 1);
                },
              ),
            () => {
              if (frames.length === 0) {
                draw().then(
                  (blob) => finish(() => resolve([blob])),
                  () => finish(() => reject(new Error("This video couldn't be read."))),
                );
                return;
              }
              finish(() => resolve(frames));
            },
          );
        };
        next(0);
      },
      { once: true },
    );
    video.src = url;
  });
}

export async function filesFromList(list: FileList | File[]): Promise<FolderRead> {
  const files = Array.from(list);
  const folderName = folderNameFromFiles(files) ?? "Dropped files";
  return { folderName, files };
}

function folderNameFromFiles(files: File[]): string | null {
  const relative = files.find((file) => file.webkitRelativePath)?.webkitRelativePath;
  if (!relative) return null;
  const [folder] = relative.split("/");
  return folder || null;
}

export async function filesFromDataTransfer(transfer: DataTransfer): Promise<FolderRead> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    return filesFromList(transfer.files);
  }

  const files: File[] = [];
  let folderName: string | null = null;
  if (entries.length === 1 && entries[0].isDirectory) {
    folderName = entries[0].name;
  }
  for (const entry of entries) {
    files.push(...(await filesFromEntry(entry)));
  }
  return { folderName: folderName ?? "Dropped files", files };
}

async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.name.startsWith(".")) return [];
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    return file.name.startsWith(".") ? [] : [file];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children = await readAllEntries(reader);
  const nested = await Promise.all(children.map((child) => filesFromEntry(child)));
  return nested.flat();
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}
