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

export async function prepareQueueItem(file: File): Promise<QueueItem> {
  const kind = mediaKind(file);
  if (kind === "video") {
    const frame = await captureVideoFrame(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "video",
      thumbUrl: URL.createObjectURL(frame),
      classifyBlob: frame,
    };
  }
  if (kind === "heic") {
    const still = await heicFileToJpeg(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "photo",
      thumbUrl: URL.createObjectURL(still),
      classifyBlob: still,
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
    classifyBlob: still,
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

export function captureVideoFrame(file: File): Promise<Blob> {
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
    }, 8000);

    const draw = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        finish(() => reject(new Error("This video couldn't be read.")));
        return;
      }
      canvasJpeg(video, width, height).then(
        (blob) => finish(() => resolve(blob)),
        () => finish(() => reject(new Error("This video couldn't be read."))),
      );
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
        const target = duration > 0.2 ? Math.min(0.45, duration * 0.2) : 0;
        if (target <= 0) {
          draw();
          return;
        }
        video.addEventListener("seeked", () => draw(), { once: true });
        try {
          video.currentTime = target;
        } catch {
          draw();
        }
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
