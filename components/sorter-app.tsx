"use client";

import { CategoryBoard } from "@/components/category-board";
import { FlightTile } from "@/components/flight-tile";
import { FlockStage } from "@/components/flock-stage";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  classifyManyWithClip,
  classifyWithClip,
  isModelRuntimeError,
  loadClipModel,
  onModelProgress,
  stopClipWorker,
} from "@/lib/clip-classifier";
import { classifyFramesWithFallback } from "@/lib/fallback-classifier";
import {
  FLOCK_FLIGHT_MAX_MS,
  FLOCK_STAGGER_MS,
  flightDuration,
  flockLook,
  flockReleaseCount,
} from "@/lib/flock";
import {
  filesFromDataTransfer,
  filesFromList,
  partitionFiles,
  prepareQueueItem,
} from "@/lib/intake";
import { loadSampleFolder } from "@/lib/sample-folder";
import type { CategoryRow, ClassifierMode, LabelHit, Point, QueueItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { buildCategoryZip, zipDownloadName } from "@/lib/zip-folders";
import { Download, FolderOpen, Images } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Phase = "empty" | "sorting" | "done";

type Held = { item: QueueItem; hit: LabelHit };

type Flight = {
  key: string;
  runId: number;
  item: QueueItem;
  from: Point;
  to: Point;
  delay: number;
  tilt: number;
  size: number;
  lift: number;
  weave: number;
  duration: number;
  categoryId: string;
  categoryName: string;
};

type LandingWait = {
  keys: Set<string>;
  resolve: () => void;
  timer: number;
};

type SorterState = {
  phase: Phase;
  folderName: string | null;
  pile: QueueItem[];
  categories: CategoryRow[];
  flights: Flight[];
  total: number;
  labeled: number;
  landed: number;
  skipped: number;
  unreadable: number;
  decodeFailures: string[];
  modelLine: string | null;
  modelRatio: number | null;
  mode: ClassifierMode | null;
  error: string | null;
  notice: string | null;
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

const EMPTY: SorterState = {
  phase: "empty",
  folderName: null,
  pile: [],
  categories: [],
  flights: [],
  total: 0,
  labeled: 0,
  landed: 0,
  skipped: 0,
  unreadable: 0,
  decodeFailures: [],
  modelLine: null,
  modelRatio: null,
  mode: null,
  error: null,
  notice: null,
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function fallbackNotice() {
  return "The vision model didn’t download, so these labels come from a smaller on-device reader. They are rougher, and they are not CLIP labels.";
}

function countItems(categories: CategoryRow[]) {
  return categories.reduce((sum, category) => sum + category.items.length, 0);
}

function withShells(categories: CategoryRow[], wave: Held[]): CategoryRow[] {
  let next = categories;
  for (const entry of wave) {
    if (!next.some((category) => category.id === entry.hit.id)) {
      next = [...next, { id: entry.hit.id, name: entry.hit.name, items: [] }];
    }
  }
  return next;
}

function withLanded(
  categories: CategoryRow[],
  categoryId: string,
  categoryName: string,
  item: QueueItem,
): CategoryRow[] {
  const index = categories.findIndex((category) => category.id === categoryId);
  if (index >= 0 && categories[index].items.some((entry) => entry.id === item.id)) {
    return categories;
  }
  const tile = {
    id: item.id,
    name: item.name,
    kind: item.kind,
    thumbUrl: item.thumbUrl,
    file: item.file,
  };
  if (index < 0) {
    return [...categories, { id: categoryId, name: categoryName, items: [tile] }];
  }
  const next = categories.slice();
  const category = next[index];
  next[index] = { ...category, items: [...category.items, tile] };
  return next;
}

function measureCenter(selector: string): Point | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function measureDock(categoryId: string, index: number): Point | null {
  const element = document.querySelector(`[data-dock="${CSS.escape(categoryId)}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    x: rect.left + 48 + (index % 6) * 14,
    y: rect.top + Math.min(rect.height / 2, 48),
  };
}

function fileWord(count: number) {
  return count === 1 ? "file" : "files";
}

export function SorterApp() {
  const [state, setState] = useState(EMPTY);
  const [dragOver, setDragOver] = useState(false);
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const runId = useRef(0);
  const urls = useRef<string[]>([]);
  const landingsRef = useRef<Set<LandingWait>>(new Set());

  useEffect(() => {
    return () => {
      runId.current += 1;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      stopClipWorker();
    };
  }, []);

  function releaseLandings() {
    for (const pending of landingsRef.current) pending.resolve();
    landingsRef.current.clear();
  }

  function noteLanding(key: string) {
    for (const tracker of landingsRef.current) {
      if (!tracker.keys.delete(key)) continue;
      if (tracker.keys.size === 0) tracker.resolve();
    }
  }

  function waitForLandings(keys: string[], run: number) {
    return new Promise<void>((resolve) => {
      if (keys.length === 0 || runId.current !== run) {
        resolve();
        return;
      }
      let settledWait = false;
      const tracker: LandingWait = {
        keys: new Set(keys),
        resolve: () => {
          if (settledWait) return;
          settledWait = true;
          landingsRef.current.delete(tracker);
          window.clearTimeout(tracker.timer);
          resolve();
        },
        timer: 0,
      };
      tracker.timer = window.setTimeout(() => {
        if (!landingsRef.current.has(tracker)) return;
        setState((current) => {
          if (runId.current !== run) return current;
          let categories = current.categories;
          const stuck = current.flights.filter((flight) => tracker.keys.has(flight.key));
          for (const flight of stuck) {
            categories = withLanded(categories, flight.categoryId, flight.categoryName, flight.item);
          }
          const added = countItems(categories) - countItems(current.categories);
          return {
            ...current,
            categories,
            flights: current.flights.filter((flight) => !tracker.keys.has(flight.key)),
            landed: current.landed + added,
          };
        });
        tracker.resolve();
      }, FLOCK_FLIGHT_MAX_MS + 280 + keys.length * FLOCK_STAGGER_MS + 600);
      landingsRef.current.add(tracker);
    });
  }

  function onFlightLand(flight: Flight) {
    setState((current) => {
      if (runId.current !== flight.runId) return current;
      const categories = withLanded(
        current.categories,
        flight.categoryId,
        flight.categoryName,
        flight.item,
      );
      const added = countItems(categories) - countItems(current.categories);
      return {
        ...current,
        categories,
        flights: current.flights.filter((entry) => entry.key !== flight.key),
        landed: current.landed + added,
      };
    });
    noteLanding(flight.key);
  }

  function dropUrlsLater(previous: string[]) {
    window.setTimeout(() => {
      previous.forEach((url) => URL.revokeObjectURL(url));
    }, 240);
  }

  async function begin(folderName: string, files: File[]) {
    const id = ++runId.current;
    releaseLandings();
    const previousUrls = urls.current;
    urls.current = [];
    setOpenCategoryId(null);
    const partition = partitionFiles(files);
    if (partition.supported.length === 0) {
      dropUrlsLater(previousUrls);
      setState({
        ...EMPTY,
        error:
          "Those files don’t include a JPEG, PNG, WebP, GIF, HEIC, HEIF, MP4, WebM, or MOV.",
        skipped: partition.skipped,
      });
      return;
    }

    setState({
      ...EMPTY,
      phase: "sorting",
      folderName,
      total: partition.supported.length,
      skipped: partition.skipped,
      modelLine: "Loading the vision model. It stays in this browser.",
      modelRatio: 0.04,
    });
    dropUrlsLater(previousUrls);

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
    const removed = new Set<string>();
    const held: Held[] = [];
    let prepDone = false;
    let producerDone = false;

    const syncPile = () => {
      setState((current) => {
        if (runId.current !== id) return current;
        const seen = new Set(current.pile.map((item) => item.id));
        const extras = prepared.filter((item) => !seen.has(item.id) && !removed.has(item.id));
        if (extras.length === 0) return current;
        return { ...current, pile: [...current.pile, ...extras] };
      });
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
          setState((current) =>
            runId.current === id
              ? {
                  ...current,
                  unreadable: current.unreadable + 1,
                  decodeFailures: [...current.decodeFailures, file.name],
                }
              : current,
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
        runId.current === id ? { ...current, mode: "clip", modelLine: null, modelRatio: null } : current,
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

    async function launchWave(wave: Held[]): Promise<void> {
      if (runId.current !== id || wave.length === 0) return;
      setState((current) =>
        runId.current === id ? { ...current, categories: withShells(current.categories, wave) } : current,
      );
      await nextPaint();
      if (runId.current !== id) return;
      document
        .querySelector(`[data-dock="${CSS.escape(wave[0].hit.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
      await nextPaint();
      if (runId.current !== id) return;

      const ids = new Set(wave.map((entry) => entry.item.id));
      for (const itemId of ids) removed.add(itemId);

      if (prefersReducedMotion()) {
        setState((current) => {
          if (runId.current !== id) return current;
          let categories = current.categories;
          for (const entry of wave) {
            categories = withLanded(categories, entry.hit.id, entry.hit.name, entry.item);
          }
          const added = countItems(categories) - countItems(current.categories);
          return {
            ...current,
            categories,
            pile: current.pile.filter((item) => !ids.has(item.id)),
            landed: current.landed + added,
          };
        });
        return;
      }

      const stage = measureCenter("[data-flock-stage]");
      const flights: Flight[] = wave.map((entry, index) => {
        const look = flockLook(entry.item.id);
        const from =
          measureCenter(`[data-flock-id="${CSS.escape(entry.item.id)}"]`) ??
          (stage ? { x: stage.x + (index % 5) * 10 - 20, y: stage.y } : { x: 140, y: 200 });
        const to = measureDock(entry.hit.id, index) ?? {
          x: Math.min(window.innerWidth * 0.72, window.innerWidth - 80),
          y: 240,
        };
        return {
          key: entry.item.id,
          runId: id,
          item: entry.item,
          from,
          to,
          delay: index * FLOCK_STAGGER_MS,
          tilt: look.tilt,
          size: look.size,
          lift: 96 + (index % 5) * 18,
          weave: (index % 2 === 0 ? 1 : -1) * (26 + (index % 4) * 8),
          duration: flightDuration(entry.item.id),
          categoryId: entry.hit.id,
          categoryName: entry.hit.name,
        };
      });

      const landedWait = waitForLandings(
        flights.map((flight) => flight.key),
        id,
      );
      setState((current) =>
        runId.current === id
          ? {
              ...current,
              flights: [...current.flights, ...flights],
              pile: current.pile.filter((item) => !ids.has(item.id)),
            }
          : current,
      );
      await landedWait;
    }

    const acceptLabel = (item: QueueItem, hit: LabelHit | null) => {
      if (runId.current !== id) return;
      if (!hit) {
        removed.add(item.id);
        setState((current) =>
          runId.current === id
            ? {
                ...current,
                unreadable: current.unreadable + 1,
                pile: current.pile.filter((entry) => entry.id !== item.id),
              }
            : current,
        );
        return;
      }
      held.push({ item, hit });
      setState((current) =>
        runId.current === id ? { ...current, labeled: current.labeled + 1 } : current,
      );
    };

    const labelOne = async (item: QueueItem) => {
      let hit: LabelHit | null = null;
      try {
        hit =
          mode === "clip"
            ? await classifyWithClip(item.classifyFrames)
            : await classifyFramesWithFallback(item.classifyFrames);
      } catch (error) {
        if (mode === "clip" && isModelRuntimeError(error)) {
          mode = "fallback";
          setState((current) =>
            runId.current === id ? { ...current, mode: "fallback", notice: fallbackNotice() } : current,
          );
          try {
            hit = await classifyFramesWithFallback(item.classifyFrames);
          } catch {
            hit = null;
          }
        }
      }
      acceptLabel(item, hit);
    };

    const producer = (async () => {
      try {
        let cursor = 0;
        while (runId.current === id) {
          const pendingCount = prepared.length - cursor;
          if (pendingCount <= 0) {
            if (prepDone) break;
            await sleep(16);
            continue;
          }
          // Let a few files gather so one model pass covers the flock,
          // unless preparation has already finished.
          if (!prepDone && pendingCount < 4) {
            await sleep(30);
            continue;
          }
          const batch: QueueItem[] = [];
          let frames = 0;
          while (cursor < prepared.length && batch.length < 8 && frames < 10) {
            const next = prepared[cursor];
            const count = Math.max(1, next.classifyFrames.length);
            if (batch.length > 0 && frames + count > 10) break;
            batch.push(next);
            frames += count;
            cursor += 1;
          }
          if (mode === "clip" && batch.length > 1) {
            try {
              const hits = await classifyManyWithClip(batch.map((item) => item.classifyFrames));
              batch.forEach((item, index) => acceptLabel(item, hits[index] ?? null));
              continue;
            } catch (error) {
              if (isModelRuntimeError(error)) {
                mode = "fallback";
                setState((current) =>
                  runId.current === id
                    ? { ...current, mode: "fallback", notice: fallbackNotice() }
                    : current,
                );
              }
            }
          }
          for (const item of batch) {
            if (runId.current !== id) return;
            await labelOne(item);
          }
        }
      } finally {
        producerDone = true;
      }
    })();

    const pendingFlights: Promise<void>[] = [];
    const folderTotal = partition.supported.length;
    const consumer = (async () => {
      while (runId.current === id) {
        const take = flockReleaseCount(held.length, producerDone, folderTotal);
        if (take > 0) {
          const wave = held.splice(0, take);
          pendingFlights.push(launchWave(wave));
          await sleep(FLOCK_STAGGER_MS);
          continue;
        }
        if (producerDone) break;
        await sleep(16);
      }
      await Promise.all(pendingFlights);
    })();

    try {
      await Promise.all([preparing, producer, consumer]);
    } catch {
      if (runId.current !== id) return;
      setState((current) =>
        runId.current === id
          ? {
              ...current,
              phase: "done",
              flights: [],
              modelLine: null,
              modelRatio: null,
              error: "The sort stopped before the flock could land.",
            }
          : current,
      );
      return;
    }
    if (runId.current !== id) return;
    setState((current) => {
      if (runId.current !== id) return current;
      let categories = current.categories;
      for (const flight of current.flights) {
        categories = withLanded(categories, flight.categoryId, flight.categoryName, flight.item);
      }
      const added = countItems(categories) - countItems(current.categories);
      return {
        ...current,
        phase: "done",
        flights: [],
        modelLine: null,
        modelRatio: null,
        categories: categories.filter((category) => category.items.length > 0),
        landed: current.landed + added,
      };
    });
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

  function resetBoard() {
    runId.current += 1;
    releaseLandings();
    const previous = urls.current;
    urls.current = [];
    setOpenCategoryId(null);
    setZipping(false);
    setState(EMPTY);
    dropUrlsLater(previous);
  }

  async function onDownload() {
    if (zipping) return;
    setZipping(true);
    setState((current) => ({ ...current, error: null }));
    try {
      const bytes = await buildCategoryZip(state.categories);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = zipDownloadName(state.folderName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setState((current) => ({
        ...current,
        error: "The folders couldn’t be packed. Try the download again.",
      }));
    } finally {
      setZipping(false);
    }
  }

  const fileCount = countItems(state.categories);
  const settled = state.phase === "done" && fileCount > 0;
  const finishedEmpty = state.phase === "done" && fileCount === 0;
  const sorting = state.phase === "sorting";
  const lifting = state.flights.length > 0;
  const readCount = state.labeled + state.unreadable;
  const progressRatio =
    state.modelRatio !== null
      ? state.modelRatio
      : state.total > 0
        ? Math.max(readCount, state.landed + state.unreadable) / state.total
        : 0;
  const statusLine = state.modelLine
    ? state.modelLine
    : lifting
      ? state.landed > 0
        ? `The flock is landing · ${state.landed} settled`
        : "The flock is landing"
      : sorting
        ? `Reading the pile · ${readCount} of ${state.total}`
        : null;

  return (
    <div
      className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden"
      data-phase={state.phase}
      data-settled={settled ? "true" : "false"}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <FlockStage
        items={state.pile}
        dragOver={dragOver}
        lifting={lifting}
        landed={settled && state.pile.length === 0 && !lifting}
      />
      <section className="paper-board flex min-h-0 min-w-0 flex-1 flex-col border-t border-[#eadfd6] md:border-t-0 md:border-l">
        <header className="shrink-0 px-6 py-7 sm:px-10 sm:py-9">
          <h1 className="text-[2.8rem] leading-none font-semibold tracking-[-0.045em] text-[#161616] sm:text-[3.35rem]">
            Starling
          </h1>
          <p className="mt-3 max-w-md text-lg leading-snug text-[#1c1c1c]">
            The pile lifts <em className="accent-word">together</em> and lands in place.
          </p>

          {state.folderName ? (
            <p className="mt-4 text-sm text-[#5e564f]">{state.folderName}</p>
          ) : null}

          {settled ? (
            <div className="mt-6 max-w-lg">
              <h2 className="text-[2.15rem] leading-none font-semibold tracking-[-0.04em] text-[#161616]">
                Settled.
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#4e4742]">
                {fileCount} {fileWord(fileCount)} in {state.categories.length}{" "}
                {state.categories.length === 1 ? "category" : "categories"}. Open one, or take the
                folders with you.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="lg"
                  className="h-11 px-4"
                  onClick={onDownload}
                  disabled={zipping}
                >
                  <Download data-icon="inline-start" />
                  {zipping ? "Packing folders…" : "Download folders"}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="h-11 bg-transparent px-4"
                  onClick={resetBoard}
                >
                  Sort another set
                </Button>
              </div>
            </div>
          ) : null}

          {finishedEmpty ? (
            <div className="mt-6 max-w-lg">
              <h2 className="text-[2.15rem] leading-none font-semibold tracking-[-0.04em]">
                Nothing landed.
              </h2>
              <div className="mt-4">
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="h-11 bg-transparent px-4"
                  onClick={resetBoard}
                >
                  Sort another set
                </Button>
              </div>
            </div>
          ) : null}

          <div className={cn("max-w-lg", settled || finishedEmpty ? "mt-6" : "mt-7")}>
            <label
              className={cn(
                buttonVariants({ size: "lg", variant: settled ? "outline" : "default" }),
                "h-11 cursor-pointer px-4",
                settled && "bg-transparent",
              )}
            >
              Choose files
              <input
                id="photo-file-input"
                type="file"
                name="photos"
                multiple
                accept={MEDIA_ACCEPT}
                aria-label="Choose files"
                className="sr-only"
                onChange={onFiles}
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <label
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "h-10 cursor-pointer bg-transparent px-3.5",
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

          {sorting && statusLine ? (
            <div className="mt-6 max-w-lg">
              <div className="h-1 overflow-hidden bg-[#eadfd6]">
                <div
                  className="h-full bg-[#171717] transition-[width] duration-300 ease-out"
                  style={{ width: `${Math.round(progressRatio * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-[#4e4742]" aria-live="polite">
                {statusLine}
              </p>
            </div>
          ) : null}

          {state.notice ? (
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#7a3050]" role="status">
              {state.notice}
            </p>
          ) : null}
          {state.error ? (
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#9d2348]" role="alert">
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
          <CategoryBoard
            categories={state.categories}
            sorting={sorting}
            settled={settled}
            finishedEmpty={finishedEmpty}
            openCategoryId={openCategoryId}
            onOpen={setOpenCategoryId}
            onClose={() => setOpenCategoryId(null)}
          />
        </div>
      </section>

      {state.flights.map((flight) => (
        <FlightTile
          key={flight.key}
          src={flight.item.thumbUrl}
          name={flight.item.name}
          kind={flight.item.kind}
          from={flight.from}
          to={flight.to}
          delay={flight.delay}
          tilt={flight.tilt}
          size={flight.size}
          lift={flight.lift}
          weave={flight.weave}
          duration={flight.duration}
          onDone={() => onFlightLand(flight)}
        />
      ))}
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
    const extra = decodeFailures.length > 3 ? `, and ${decodeFailures.length - 3} more` : "";
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
  return <p className="mt-3 max-w-lg text-sm text-[#5e564f]">{parts.join(" ")}</p>;
}
