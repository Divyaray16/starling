import { zip } from "fflate";
import type { CategoryRow } from "@/lib/types";

function itemsInSlotOrder(category: CategoryRow) {
  const landed = new Map(category.items.map((item) => [item.id, item]));
  const order = category.slots.length > 0 ? category.slots : category.items.map((item) => item.id);
  const ordered: typeof category.items = [];
  for (const id of order) {
    const item = landed.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
}

function safeSegment(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return cleaned.slice(0, 80) || "Untitled";
}

function uniqueName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "file";
  const key = base.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let n = 2;
  let next = `${stem}-${n}${ext}`;
  while (used.has(next.toLowerCase())) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  used.add(next.toLowerCase());
  return next;
}

/**
 * One folder per category. Each entry is the original file bytes: a HEIC stays
 * a HEIC, not the JPEG preview used for the thumbnail and the classifier.
 */
export async function buildCategoryZip(categories: CategoryRow[]): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const category of categories) {
    if (category.items.length === 0) continue;
    const folder = safeSegment(category.name);
    const used = new Set<string>();
    for (const item of itemsInSlotOrder(category)) {
      const filename = uniqueName(item.file.name || "file", used);
      entries[`${folder}/${filename}`] = new Uint8Array(await item.file.arrayBuffer());
    }
  }
  if (Object.keys(entries).length === 0) {
    throw new Error("Nothing to pack.");
  }
  return new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (error, data) => {
      if (error || !data) reject(error ?? new Error("The zip could not be built."));
      else resolve(data);
    });
  });
}

export function zipDownloadName(folderName: string | null): string {
  const base = (folderName ?? "photos")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `starling-${base || "photos"}.zip`;
}
