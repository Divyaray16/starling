"use client";

import { CategoryRail } from "@/components/category-rail";
import { FlightTile } from "@/components/flight-tile";
import { PileStage } from "@/components/pile-stage";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  classifyWithClip,
  isModelRuntimeError,
  loadClipModel,
  onModelProgress,
  stopClipWorker,
} from "@/lib/clip-classifier";
import { classifyBlobWithFallback } from "@/lib/fallback-classifier";
import {
  filesFromDataTransfer,
  filesFromList,
  partitionFiles,
  prepareQueueItem,
} from "@/lib/intake";
import { loadSampleFolder } from "@/lib/sample-folder";
import type { CategoryRow, ClassifierMode, LabelHit, Point, QueueItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FolderOpen, Images } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Phase = "empty" | "sorting" | "done";

type Flight = {
  item: QueueItem;
  from: Point;
  to: Point;
};

const MEDIA_ACCEPT = [
  "image/*",
  "video/*",
  ".heic",
  ".heif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".mp4",
  ".webm",
  ".mov",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
].join(",");

const EMPTY_COPY = {
  phase: "empty" as Phase,
  folderName: null as string | null,
  pile: [] as QueueItem[],
  categories: [] as CategoryRow[],
  flight: null as Flight | null,
  total: 0,
  classified: 0,
  skipped: 0,
  unreadable: 0,
  decodeFailures: [] as string[],
  currentName: null as string | null,
  modelLine: null as string | null,
  modelRatio: null as number | null,
  mode: null as ClassifierMode | null,
  error: null as string | null,
  notice: null as string | null,
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function measurePoint(selector: string, anchor: "start" | "end"): Point | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (anchor === "end") {
    return {
      x: Math.min(rect.right + 8, window.innerWidth - 110),
      y: rect.top,
    };
  }
  return { x: rect.left, y: rect.top };
}

function fallbackNotice() {
  return "The vision model didn’t download, so these labels come from a smaller on-device reader. They are rougher, and they are not CLIP labels.";
}

export function SorterApp() {
  const [state, setState] = useState(EMPTY_COPY);
  const [dragOver, setDragOver] = useState(false);
  const runId = useRef(0);
  const urls = useRef<string[]>([]);
  const flightDone = useRef<(() => void) | null>(null);
  const landedRef = useRef<CategoryRow[]>([]);

  useEffect(() => {
    return () => {
      runId.current += 1;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      stopClipWorker();
    };
  }, []);

  function revokeUrls() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
  }

  function waitForFlight() {
    return new Promise<void>((resolve) => {
      flightDone.current = resolve;
    });
  }

  async function begin(folderName: string, files: File[]) {
    const id = ++runId.current;
    revokeUrls();
    const partition = partitionFiles(files);
    if (partition.supported.length === 0) {
      setState({
        ...EMPTY_COPY,
        error:
          "Those files don’t include a JPEG, PNG, WebP, GIF, HEIC, HEIF, MP4, WebM, or MOV.",
        skipped: partition.skipped,
      });
      return;
    }

    setState({
      ...EMPTY_COPY,
      phase: "sorting",
      folderName,
      total: partition.supported.length,
      skipped: partition.skipped,
      modelLine: "Loading the vision model. It stays in this browser.",
      modelRatio: 0.04,
    });

    onModelProgress((progress) => {
      if (runId.current !== id) return;
      if (progress.status === "progress" && progress.total) {
        const ratio = Math.max(0, Math.min(1, progress.loaded! / progress.total));
        const file = progress.file?.split("/").pop() ?? "vision model";
        setState((current) =>
          current.phase === "sorting" && runId.current === id
            ? { ...current, modelLine: `Downloading ${file}`, modelRatio: ratio }
            : current,
        );
      } else if (progress.status === "initiate" || progress.status === "download") {
        setState((current) =>
          current.phase === "sorting" && !current.modelLine
            ? { ...current, modelLine: "Downloading the vision model" }
            : current,
        );
      }
    });

    const prepared: QueueItem[] = [];
    landedRef.current = [];
    let prepDone = false;
    let unreadable = 0;
    const decodeFailures: string[] = [];
    const removed = new Set<string>();

    const syncPile = () => {
      setState((current) =>
        runId.current === id
          ? { ...current, pile: prepared.filter((item) => !removed.has(item.id)) }
          : current,
      );
    };

    const preparing = (async () => {
      for (const file of partition.supported) {
        if (runId.current !== id) return;
        try {
          const item = await prepareQueueItem(file);
          if (runId.current !== id) {
            URL.revokeObjectURL(item.thumbUrl);
            return;
          }
          prepared.push(item);
          urls.current.push(item.thumbUrl);
          syncPile();
        } catch {
          unreadable += 1;
          decodeFailures.push(file.name);
          const failed = [...decodeFailures];
          setState((current) =>
            runId.current === id ? { ...current, unreadable, decodeFailures: failed } : current,
          );
        }
      }
      prepDone = true;
    })();

    let mode: ClassifierMode = "clip";
    try {
      await loadClipModel();
      if (runId.current !== id) return;
      mode = "clip";
      setState((current) =>
        runId.current === id
          ? { ...current, mode: "clip", modelLine: null, modelRatio: null }
          : current,
      );
    } catch {
      mode = "fallback";
      setState((current) =>
        runId.current === id
          ? {
              ...current,
              mode: "fallback",
              modelLine: null,
              modelRatio: null,
              notice: fallbackNotice(),
            }
          : current,
      );
    }

    let classified = 0;
    let cursor = 0;

    while (runId.current === id) {
      if (cursor >= prepared.length) {
        if (prepDone) break;
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        continue;
      }
      const item = prepared[cursor];
      cursor += 1;
      setState((current) =>
        runId.current === id ? { ...current, currentName: item.name } : current,
      );

      let hit: LabelHit | null = null;
      try {
        hit =
          mode === "clip"
            ? await classifyWithClip(item.classifyBlob)
            : await classifyBlobWithFallback(item.classifyBlob);
      } catch (error) {
        if (mode === "clip" && isModelRuntimeError(error)) {
          mode = "fallback";
          setState((current) =>
            runId.current === id
              ? { ...current, mode: "fallback", notice: fallbackNotice() }
              : current,
          );
          try {
            hit = await classifyBlobWithFallback(item.classifyBlob);
          } catch {
            hit = null;
          }
        }
      }

      if (runId.current !== id) return;
      if (!hit) {
        unreadable += 1;
        removed.add(item.id);
        setState((current) =>
          runId.current === id ? { ...current, unreadable, pile: prepared.filter((entry) => !removed.has(entry.id)) } : current,
        );
        continue;
      }

      const exists = landedRef.current.some((category) => category.id === hit.id);
      await nextPaint();
      if (runId.current !== id) return;
      const from =
        measurePoint(`[data-pile-id="${CSS.escape(item.id)}"]`, "start") ??
        measurePoint("[data-pile-stage]", "start") ?? { x: 48, y: 160 };
      const dockSelector = exists
        ? `[data-dock="${CSS.escape(hit.id)}"]`
        : '[data-dock="incoming"]';
      document.querySelector(dockSelector)?.scrollIntoView({ block: "nearest" });
      const to = measurePoint(dockSelector, exists ? "end" : "start") ?? {
        x: window.innerWidth * 0.72,
        y: 180,
      };

      removed.add(item.id);
      if (!prefersReducedMotion()) {
        const flightWait = waitForFlight();
        setState((current) =>
          runId.current === id
            ? {
                ...current,
                flight: { item, from, to },
                pile: prepared.filter((entry) => !removed.has(entry.id)),
              }
            : current,
        );
        await flightWait;
        if (runId.current !== id) return;
      }

      const landed = {
        id: item.id,
        name: item.name,
        kind: item.kind,
        thumbUrl: item.thumbUrl,
      };
      classified += 1;
      const previous = landedRef.current;
      const categories = previous.some((category) => category.id === hit.id)
        ? previous.map((category) =>
            category.id === hit.id
              ? { ...category, items: [...category.items, landed] }
              : category,
          )
        : [...previous, { id: hit.id, name: hit.name, items: [landed] }];
      landedRef.current = categories;
      setState((current) =>
        runId.current === id
          ? {
              ...current,
              categories,
              classified,
              flight: null,
              pile: prepared.filter((entry) => !removed.has(entry.id)),
              unreadable,
            }
          : current,
      );
    }

    await preparing;
    if (runId.current !== id) return;
    setState((current) =>
      runId.current === id
        ? { ...current, phase: "done", currentName: null, flight: null, modelLine: null }
        : current,
    );
  }

  async function onSample() {
    setState((current) => ({ ...current, error: null }));
    try {
      const sample = await loadSampleFolder();
      await begin(sample.folderName, sample.files);
    } catch (error) {
      setState((current) => ({
        ...current,
        error:
          error instanceof Error
            ? error.message
            : "The sample photos didn’t load. Refresh and try again.",
      }));
    }
  }

  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    await begin("Selected files", files);
  }

  async function onDirectory(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const folder = await filesFromList(files);
    await begin(folder.folderName, folder.files);
  }

  async function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    try {
      const folder = await filesFromDataTransfer(event.dataTransfer);
      if (folder.files.length === 0) {
        setState((current) => ({
          ...current,
          error: "Nothing in that drop could be read as photos or videos.",
        }));
        return;
      }
      await begin(folder.folderName, folder.files);
    } catch {
      setState((current) => ({
        ...current,
        error: "That drop couldn’t be read. Use the file control instead.",
      }));
    }
  }

  const progressRatio =
    state.modelRatio !== null
      ? state.modelRatio
      : state.total > 0
        ? (state.classified + state.unreadable) / state.total
        : 0;
  const sorting = state.phase === "sorting";
  const showProgress = sorting || state.phase === "done";

  return (
    <div
      className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <PileStage items={state.pile} dragOver={dragOver} />
      <section className="paper-ledger flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-b border-[#e4d8c8] px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div
              className="grid size-11 place-items-center bg-[#1c1612] font-serif text-2xl text-[#f3e6d8]"
              aria-hidden
            >
              D
            </div>
            <div>
              <h1 className="font-serif text-[2.5rem] leading-none tracking-tight text-[#241c17]">
                Divya
              </h1>
              <p className="mt-1 text-sm text-[#6e6258]">The sort comes from the photos.</p>
            </div>
          </div>

          {state.folderName ? (
            <div className="mt-5">
              <p className="font-serif text-[1.8rem] leading-tight text-[#241c17]">
                {state.folderName}
              </p>
              <p className="mt-1 max-w-lg text-sm leading-relaxed text-[#6e6258]">
                {state.phase === "done"
                  ? "Sorted from the photos in this folder. Nothing was uploaded."
                  : "Sorting the photos in this folder. Nothing is uploaded."}
              </p>
            </div>
          ) : null}

          <div className="mt-5 max-w-lg">
            <p className="text-sm text-[#5c5148]">
              {state.phase === "empty" ? "Choose photos and videos" : "Choose more photos and videos"}
            </p>
            <input
              id="photo-file-input"
              type="file"
              name="photos"
              multiple
              accept={MEDIA_ACCEPT}
              aria-label="Choose photos and videos"
              className="mt-2 block w-full cursor-pointer text-sm text-[#241c17] file:mr-3 file:h-10 file:cursor-pointer file:border-0 file:bg-[#1c1612] file:px-3.5 file:text-sm file:font-medium file:text-[#f3e6d8]"
              onChange={onFiles}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <label
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "relative h-10 cursor-pointer overflow-hidden bg-transparent px-3.5",
                )}
              >
                <FolderOpen data-icon="inline-start" />
                Choose a folder
                <input
                  id="folder-file-input"
                  type="file"
                  className="sr-only"
                  aria-label="Choose a folder of photos and videos"
                  {...{ webkitdirectory: "", directory: "" }}
                  onChange={onDirectory}
                />
              </label>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-10 bg-transparent px-3.5"
                onClick={onSample}
              >
                <Images data-icon="inline-start" />
                Try a sample folder
              </Button>
            </div>
          </div>

          {showProgress ? (
            <div className="mt-5 max-w-lg">
              <div className="h-1 overflow-hidden bg-[#e6dccf]">
                <div
                  className="h-full bg-[#c46b45] transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.round(progressRatio * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-[#5c5148]" aria-live="polite">
                {state.modelLine
                  ? state.modelLine
                  : state.currentName
                    ? `${state.classified} of ${state.total} · ${state.currentName}`
                    : `${state.classified} of ${state.total} sorted`}
              </p>
            </div>
          ) : null}

          {state.notice ? (
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#6d3a28]" role="status">
              {state.notice}
            </p>
          ) : null}
          {state.error ? (
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#6d3a28]" role="alert">
              {state.error}
            </p>
          ) : null}
          <SkipLine
            skipped={state.skipped}
            unreadable={state.unreadable}
            decodeFailures={state.decodeFailures}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CategoryRail categories={state.categories} sorting={sorting} />
        </div>
      </section>

      {state.flight ? (
        <FlightTile
          src={state.flight.item.thumbUrl}
          name={state.flight.item.name}
          kind={state.flight.item.kind}
          from={state.flight.from}
          to={state.flight.to}
          onDone={() => {
            const done = flightDone.current;
            flightDone.current = null;
            done?.();
          }}
        />
      ) : null}

    </div>
  );
}

function SkipLine({
  skipped,
  unreadable,
  decodeFailures,
}: {
  skipped: number;
  unreadable: number;
  decodeFailures: string[];
}) {
  if (skipped === 0 && unreadable === 0 && decodeFailures.length === 0) return null;
  const parts: string[] = [];
  if (skipped > 0) {
    parts.push(
      skipped === 1
        ? "Skipped 1 file that isn’t a photo or video this browser can read."
        : `Skipped ${skipped} files that aren’t photos or videos this browser can read.`,
    );
  }
  if (decodeFailures.length === 1) {
    parts.push(`Couldn’t decode ${decodeFailures[0]}. That file was left out.`);
  } else if (decodeFailures.length > 1) {
    const shown = decodeFailures.slice(0, 3).join(", ");
    const extra =
      decodeFailures.length > 3 ? `, and ${decodeFailures.length - 3} more` : "";
    parts.push(
      `Couldn’t decode ${decodeFailures.length} files (${shown}${extra}). Those files were left out.`,
    );
  }
  const other = unreadable - decodeFailures.length;
  if (other > 0) {
    parts.push(
      `${other} ${other === 1 ? "file" : "files"} couldn’t be read and ${other === 1 ? "was" : "were"} left out.`,
    );
  }
  return <p className="mt-3 max-w-lg text-sm text-[#6e6258]">{parts.join(" ")}</p>;
}
