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
  FLOCK_VISIBLE,
  flightDuration,
  flockLook,
  flockReleaseCount,
} from "@/lib/flock";
import {
  filesFromDataTransfer,
  filesFromList,
  partitionFiles,
  prepareQueueItem,
  rememberFiles,
  takeNewFiles,
} from "@/lib/intake";
import { loadSampleFolder } from "@/lib/sample-folder";
import type { CategoryRow, ClassifierMode, LabelHit, Point, QueueItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { buildCategoryZip, zipDownloadName } from "@/lib/zip-folders";
import { Check, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
  dockScale: number;
  layer: number;
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
  /** True from the first departure until the batch has finished landing. */
  releasing: boolean;
};

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
  releasing: false,
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function markDirectoryInput(node: HTMLInputElement | null) {
  if (!node) return;
  node.multiple = true;
  node.setAttribute("webkitdirectory", "");
  node.setAttribute("directory", "");
  try {
    (node as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
  } catch {
    // The content attribute is already present when the property is read-only.
  }
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
      next = [...next, { id: entry.hit.id, name: entry.hit.name, items: [], slots: [] }];
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
    return [...categories, { id: categoryId, name: categoryName, items: [tile], slots: [item.id] }];
  }
  const next = categories.slice();
  const category = next[index];
  const slots = category.slots.includes(item.id) ? category.slots : [...category.slots, item.id];
  next[index] = { ...category, items: [...category.items, tile], slots };
  return next;
}

/** Hold each incoming tile's place in the row before anything leaves the pile. */
function withReservations(categories: CategoryRow[], wave: Held[]): CategoryRow[] {
  let next = categories.map((category) => ({
    ...category,
    slots: category.slots.length > 0 ? [...category.slots] : category.items.map((item) => item.id),
  }));
  for (const entry of wave) {
    const index = next.findIndex((category) => category.id === entry.hit.id);
    if (index < 0) continue;
    const category = next[index];
    if (category.slots.includes(entry.item.id)) continue;
    next = next.slice();
    next[index] = { ...category, slots: [...category.slots, entry.item.id] };
  }
  return next;
}

function measureCenter(selector: string): Point | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** A slot we can fly to: on screen, and fully inside its strip when it has one. */
function slotVisible(slotId: string): boolean {
  const node = document.querySelector(`[data-dock-slot="${CSS.escape(slotId)}"]`);
  if (!(node instanceof HTMLElement)) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const board = document.querySelector("[data-board-scroll]");
  const view =
    board instanceof HTMLElement
      ? board.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  if (cy < view.top + 6 || cy > view.bottom - 6) return false;
  if (cx < view.left + 4 || cx > view.right - 4) return false;
  const strip = node.closest("[data-dock]");
  if (strip instanceof HTMLElement) {
    const bounds = strip.getBoundingClientRect();
    if (cx < bounds.left + 4 || cx > bounds.right - 4) return false;
    if (cy < bounds.top - 2 || cy > bounds.bottom + 2) return false;
  }
  return true;
}

/** Bring a below-the-fold slot into the board. Returns whether the scroller moved. */
function scrollSlotIntoBoard(slotId: string): boolean {
  const node = document.querySelector(`[data-dock-slot="${CSS.escape(slotId)}"]`);
  const scroller = document.querySelector("[data-board-scroll]");
  if (!(node instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return false;
  const rect = node.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (rect.top >= view.top + 8 && rect.bottom <= view.bottom - 8) return false;
  const before = scroller.scrollTop;
  scroller.scrollTop += rect.top - view.top - 12;
  return Math.abs(scroller.scrollTop - before) > 1;
}

/** Slide a category strip so its earliest still-flying card is in view. */
function revealEarliestSlots(queue: Held[]) {
  const seen = new Set<string>();
  for (const entry of queue) {
    if (seen.has(entry.hit.id)) continue;
    seen.add(entry.hit.id);
    const earliest = queue.find((other) => other.hit.id === entry.hit.id);
    if (!earliest || slotVisible(earliest.item.id)) continue;
    const node = document.querySelector(`[data-dock-slot="${CSS.escape(earliest.item.id)}"]`);
    if (!(node instanceof HTMLElement)) continue;
    const strip = node.closest("[data-dock]");
    if (!(strip instanceof HTMLElement)) continue;
    const nodeRect = node.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const delta = nodeRect.left - stripRect.left - 6;
    if (Math.abs(delta) > 1) strip.scrollLeft += delta;
  }
}

function measureSlot(slotId: string): { center: Point; width: number } | null {
  const element = document.querySelector(`[data-dock-slot="${CSS.escape(slotId)}"]`);
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  return {
    center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    width: rect.width,
  };
}

const SAVED_FLASH_MS = 2000;

/** Manual correction. The original file moves with the tile; nothing is reclassified. */
function moveLandedTile(
  categories: CategoryRow[],
  itemId: string,
  fromId: string,
  toId: string,
): CategoryRow[] {
  if (fromId === toId) return categories;
  const from = categories.find((category) => category.id === fromId);
  const to = categories.find((category) => category.id === toId);
  if (!from || !to) return categories;
  const item = from.items.find((entry) => entry.id === itemId);
  if (!item || to.items.some((entry) => entry.id === itemId)) return categories;

  const orderOf = (category: CategoryRow) =>
    category.slots.length > 0 ? category.slots : category.items.map((entry) => entry.id);

  const next: CategoryRow[] = [];
  for (const category of categories) {
    if (category.id === fromId) {
      const items = category.items.filter((entry) => entry.id !== itemId);
      if (items.length === 0) continue;
      next.push({
        ...category,
        items,
        slots: orderOf(category).filter((id) => id !== itemId),
      });
      continue;
    }
    if (category.id === toId) {
      next.push({
        ...category,
        items: [...category.items, item],
        slots: [...orderOf(category).filter((id) => id !== itemId), itemId],
      });
      continue;
    }
    next.push(category);
  }
  return next;
}

/**
 * Bring the landing rows into the board before they are measured. Scrolling
 * during the flight would move the dock out from under the tiles.
 */
function revealDocks(ids: string[]) {
  const nodes = ids
    .map((slotId) => document.querySelector(`[data-dock-slot="${CSS.escape(slotId)}"]`))
    .filter((node): node is HTMLElement => node instanceof HTMLElement);
  if (nodes.length === 0) return;
  const rects = nodes.map((node) => node.getBoundingClientRect());
  const minTop = Math.min(...rects.map((rect) => rect.top));
  const maxBottom = Math.max(...rects.map((rect) => rect.bottom));
  const scroller = document.querySelector("[data-board-scroll]");
  if (scroller instanceof HTMLElement && scroller.scrollHeight > scroller.clientHeight + 2) {
    const view = scroller.getBoundingClientRect();
    const span = maxBottom - minTop;
    const delta =
      span <= view.height
        ? (minTop + maxBottom) / 2 - (view.top + view.bottom) / 2
        : minTop - view.top - 12;
    if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    return;
  }
  if (minTop < 8 || maxBottom > window.innerHeight - 8) {
    const mid = (minTop + maxBottom) / 2;
    window.scrollTo({
      top: Math.max(0, window.scrollY + mid - window.innerHeight / 2),
      behavior: "instant",
    });
  }
}

function fileWord(count: number) {
  return count === 1 ? "file" : "files";
}

function mergeFolderName(current: string | null, incoming: string): string {
  if (!current) return incoming;
  const parts = current.split(" · ").filter(Boolean);
  if (parts.includes(incoming)) return parts.join(" · ");
  parts.push(incoming);
  if (parts.length <= 2) return parts.join(" · ");
  return `${parts[0]} · ${parts.length - 1} more`;
}

export function SorterApp() {
  const [state, setState] = useState(EMPTY);
  const [dragOver, setDragOver] = useState(false);
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [downloadSaved, setDownloadSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const runId = useRef(0);
  const urls = useRef<string[]>([]);
  const landingsRef = useRef<Set<LandingWait>>(new Set());
  const seenKeys = useRef<Set<string>>(new Set());
  const intakeQueue = useRef<File[]>([]);
  const sessionLive = useRef(false);
  const pipelineRunning = useRef(false);
  const pipelineToken = useRef(0);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const setFolderInput = useCallback((node: HTMLInputElement | null) => {
    folderInputRef.current = node;
    markDirectoryInput(node);
  }, []);

  useEffect(() => {
    return () => {
      runId.current += 1;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      stopClipWorker();
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    };
  }, []);

  const closeCategory = useCallback(() => setOpenCategoryId(null), []);

  const onMoveTile = useCallback((itemId: string, fromId: string, toId: string) => {
    if (fromId === toId) return;
    setState((current) => {
      if (current.phase !== "done") return current;
      const categories = moveLandedTile(current.categories, itemId, fromId, toId);
      if (categories === current.categories) return current;
      return { ...current, categories };
    });
  }, []);

  function clearSavedFlash() {
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
    setDownloadSaved(false);
  }

  function showSavedFlash() {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    setDownloadSaved(true);
    savedTimer.current = window.setTimeout(() => {
      savedTimer.current = null;
      setDownloadSaved(false);
    }, SAVED_FLASH_MS);
  }

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

  /**
   * Adds into the open session. A later pick never replaces files already
   * here, and canceling the dialog never reaches this function. Sort another
   * set is the only way back to the empty board. Nothing is written to
   * localStorage or IndexedDB, so a fresh load starts empty.
   */
  function acceptFiles(folderName: string, files: File[]) {
    const fresh = takeNewFiles(files, seenKeys.current);
    if (fresh.length === 0) return;
    const partition = partitionFiles(fresh);
    rememberFiles(fresh, seenKeys.current);

    if (partition.supported.length === 0) {
      if (!sessionLive.current) {
        setState({
          ...EMPTY,
          error:
            "Those files don’t include a JPEG, PNG, WebP, GIF, HEIC, HEIF, MP4, WebM, or MOV.",
          skipped: partition.skipped,
        });
        return;
      }
      if (partition.skipped > 0) {
        setState((current) => ({
          ...current,
          skipped: current.skipped + partition.skipped,
        }));
      }
      return;
    }

    sessionLive.current = true;
    intakeQueue.current.push(...partition.supported);
    setOpenCategoryId(null);
    setState((current) => {
      const showBoot = !current.mode && current.phase === "empty";
      return {
        ...current,
        phase: "sorting",
        folderName: mergeFolderName(current.folderName, folderName),
        total: current.total + partition.supported.length,
        skipped: current.skipped + partition.skipped,
        error: null,
        modelLine: showBoot
          ? "Loading the vision model. It stays in this browser."
          : current.modelLine,
        modelRatio: showBoot ? 0.04 : current.modelRatio,
      };
    });
    void runPipeline();
  }

  async function runPipeline() {
    if (pipelineRunning.current) return;
    pipelineRunning.current = true;
    const token = ++pipelineToken.current;
    const id = runId.current;
    try {
      await execute(id);
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
              releasing: false,
            }
          : current,
      );
    } finally {
      if (pipelineToken.current === token) pipelineRunning.current = false;
    }
    if (pipelineToken.current === token && runId.current === id && intakeQueue.current.length > 0) {
      void runPipeline();
    }
  }

  async function execute(id: number) {
    while (runId.current === id) {
      if (intakeQueue.current.length === 0) {
        await sleep(40);
        if (runId.current !== id) return;
        if (intakeQueue.current.length === 0) break;
      }
      await runOneDrain(id);
    }
    if (runId.current !== id) return;
    markDone(id);
  }

  function markDone(id: number) {
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
        releasing: false,
        modelLine: null,
        modelRatio: null,
        categories: categories.filter((category) => category.items.length > 0),
        landed: current.landed + added,
      };
    });
  }

  async function runOneDrain(id: number) {

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

    // This drain is one delivery: the files already queued. A later pick is
    // the next batch. Every file here is decoded and shown before any of
    // them is classified or flown.
    const batch = intakeQueue.current.splice(0, intakeQueue.current.length);

    const preparing = (async () => {
      try {
        for (const file of batch) {
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
        if (runId.current === id) await nextPaint();
      } finally {
        prepDone = true;
      }
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

    function commitLand(list: Held[]) {
      if (list.length === 0 || runId.current !== id) return;
      const ids = new Set(list.map((entry) => entry.item.id));
      for (const itemId of ids) removed.add(itemId);
      setState((current) => {
        if (runId.current !== id) return current;
        let categories = current.categories;
        for (const entry of list) {
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
    }

    /** Fly one wave onto slots that were already laid out and measured. */
    async function launchWave(wave: Held[]): Promise<void> {
      if (runId.current !== id || wave.length === 0) return;
      const flights: Flight[] = [];
      const missed: Held[] = [];
      for (const entry of wave) {
        const from = measureCenter(`[data-flock-id="${CSS.escape(entry.item.id)}"]`);
        const slot = measureSlot(entry.item.id);
        if (!from || !slot) {
          missed.push(entry);
          continue;
        }
        const look = flockLook(entry.item.id);
        flights.push({
          key: entry.item.id,
          runId: id,
          item: entry.item,
          from,
          to: slot.center,
          delay: flights.length * FLOCK_STAGGER_MS,
          tilt: look.tilt,
          size: look.size,
          dockScale: slot.width / look.size,
          layer: 40 + flights.length,
          duration: flightDuration(entry.item.id),
          categoryId: entry.hit.id,
          categoryName: entry.hit.name,
        });
      }
      if (missed.length > 0) commitLand(missed);
      if (flights.length === 0 || runId.current !== id) return;
      const ids = new Set(flights.map((flight) => flight.item.id));
      for (const itemId of ids) removed.add(itemId);
      const landedWait = waitForLandings(
        flights.map((flight) => flight.key),
        id,
      );
      setState((current) =>
        runId.current === id
          ? {
              ...current,
              releasing: true,
              flights: [...current.flights, ...flights],
              pile: current.pile.filter((item) => !ids.has(item.id)),
            }
          : current,
      );
      await landedWait;
    }

    /**
     * The pile is ready and every file in this batch is labeled. Reserve the
     * real row layout (full names, equal slots), then fly only the
     * cards you can see, in waves, onto slots that are actually on screen.
     * Everything else lands in its row without a flying node.
     */
    async function releaseFlock(entries: Held[]) {
      if (runId.current !== id || entries.length === 0) return;
      for (const entry of entries) removed.add(entry.item.id);

      if (prefersReducedMotion()) {
        commitLand(entries);
        return;
      }

      setState((current) =>
        runId.current === id
          ? {
              ...current,
              categories: withReservations(withShells(current.categories, entries), entries),
            }
          : current,
      );
      await nextPaint();
      if (runId.current !== id) return;
      document.querySelectorAll("[data-dock]").forEach((node) => {
        if (node instanceof HTMLElement) node.scrollLeft = 0;
      });
      revealDocks(entries.map((entry) => entry.item.id));
      await nextPaint();
      if (runId.current !== id) return;

      const onPile: Held[] = [];
      const offPile: Held[] = [];
      for (const entry of entries) {
        const shown = measureCenter(`[data-flock-id="${CSS.escape(entry.item.id)}"]`);
        if (shown && onPile.length < FLOCK_VISIBLE) onPile.push(entry);
        else offPile.push(entry);
      }
      if (offPile.length > 0) {
        commitLand(offPile);
        await nextPaint();
        if (runId.current !== id) return;
      }

      const onScreen = (entry: Held) =>
        Boolean(measureCenter(`[data-flock-id="${CSS.escape(entry.item.id)}"]`)) &&
        slotVisible(entry.item.id);

      let queue = onPile;
      let guard = 0;
      while (queue.length > 0 && runId.current === id && guard < 40) {
        guard += 1;
        if (!queue.some(onScreen)) {
          const next = queue.find((entry) =>
            measureCenter(`[data-flock-id="${CSS.escape(entry.item.id)}"]`),
          );
          if (!next) {
            commitLand(queue);
            break;
          }
          revealEarliestSlots([next]);
          const moved = scrollSlotIntoBoard(next.item.id);
          await nextPaint();
          if (runId.current !== id) return;
          if (!moved && !onScreen(next)) {
            commitLand(queue);
            break;
          }
          continue;
        }
        revealEarliestSlots(queue);
        await nextPaint();
        if (runId.current !== id) return;
        const take = flockReleaseCount(queue.length, true);
        const wave: Held[] = [];
        const later: Held[] = [];
        for (const entry of queue) {
          if (wave.length < take && onScreen(entry)) wave.push(entry);
          else later.push(entry);
        }
        if (wave.length === 0) {
          commitLand(queue);
          break;
        }
        await launchWave(wave);
        queue = later;
      }
      if (queue.length > 0 && runId.current === id) commitLand(queue);
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
          if (!prepDone) {
            await sleep(16);
            continue;
          }
          const pendingCount = prepared.length - cursor;
          if (pendingCount <= 0) break;
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

    const consumer = (async () => {
      while (runId.current === id && !producerDone) {
        await sleep(16);
      }
      if (runId.current !== id) return;
      const ready = held.splice(0, held.length);
      await releaseFlock(ready);
    })();

    await Promise.all([preparing, producer, consumer]);
    if (runId.current !== id) return;
  }

  async function onSample() {
    setState((current) => ({ ...current, error: null }));
    try {
      const sample = await loadSampleFolder();
      acceptFiles(sample.folderName, sample.files);
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

  async function onDirectory(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const folder = await filesFromList(files);
    acceptFiles(folder.folderName, folder.files);
  }

  async function onDrop(event: React.DragEvent<HTMLElement>) {
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
      acceptFiles(folder.folderName, folder.files);
    } catch {
      setState((current) => ({
        ...current,
        error: "That drop couldn’t be read. Use the file control instead.",
      }));
    }
  }

  function resetBoard() {
    runId.current += 1;
    pipelineToken.current += 1;
    pipelineRunning.current = false;
    sessionLive.current = false;
    intakeQueue.current = [];
    seenKeys.current = new Set();
    releaseLandings();
    const previous = urls.current;
    urls.current = [];
    setOpenCategoryId(null);
    setZipping(false);
    clearSavedFlash();
    setState(EMPTY);
    dropUrlsLater(previous);
  }

  async function onDownload() {
    if (zipping) return;
    clearSavedFlash();
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
      showSavedFlash();
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
  const lifting = state.flights.length > 0 || state.releasing;
  const readCount = state.labeled + state.unreadable;
  const intakeOpen =
    state.modelLine !== null ||
    state.pile.length > 0 ||
    (state.total > 0 && readCount < state.total);
  const preparing = sorting && !lifting && intakeOpen;
  const statusLine = state.modelLine
    ? state.modelLine
    : lifting
      ? state.landed > 0
        ? `The flock is landing · ${state.landed} settled`
        : "The flock is landing"
      : preparing
        ? state.total > 0
          ? `Sorting the pile · ${readCount} of ${state.total}`
          : "Sorting the pile"
        : null;
  const pileClear =
    sorting &&
    !lifting &&
    state.pile.length === 0 &&
    state.total > 0 &&
    readCount >= state.total &&
    state.modelLine === null;
  const showSortFlock = Boolean(statusLine?.startsWith("Sorting the pile"));
  const breathing = showSortFlock;
  const downloadLabel = downloadSaved ? "Saved" : zipping ? "Packing folders…" : "Download folders";

  return (
    <div
      className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden"
      data-phase={state.phase}
      data-settled={settled ? "true" : "false"}
      data-files={fileCount}
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
        landed={(settled || pileClear) && state.pile.length === 0 && !lifting}
        breathing={breathing}
      />
      <section className="paper-board flex min-h-0 min-w-0 flex-1 flex-col border-t border-[#d3dcd0] md:border-t-0 md:border-l">
        <header className="shrink-0 px-6 py-7 sm:px-10 sm:py-9">
          <h1 className="text-[2.8rem] leading-none font-semibold tracking-[-0.045em] text-[#3c443e] sm:text-[3.35rem]">
            Starling
          </h1>
          <p className="mt-3 max-w-md text-lg leading-snug text-[#3c443e]">
            The pile lifts <em className="accent-word">together</em> and lands in place.
          </p>

          {state.folderName ? (
            <p className="mt-4 text-sm text-[#5f6a62]">{state.folderName}</p>
          ) : null}

          {settled ? (
            <div className="mt-6 max-w-lg">
              <h2 className="text-[2.15rem] leading-none font-semibold tracking-[-0.04em] text-[#3c443e]">
                Settled.
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#5a645c]">
                {fileCount} {fileWord(fileCount)} in {state.categories.length}{" "}
                {state.categories.length === 1 ? "category" : "categories"}. Open one, or take the
                folders with you.
              </p>
              <div className="mt-4">
                <Button
                  type="button"
                  size="lg"
                  className="h-11 gap-1.5 rounded-2xl px-4"
                  onClick={onDownload}
                  disabled={zipping}
                  data-download-label={downloadLabel}
                >
                  {downloadSaved ? (
                    <Check data-icon="inline-start" className="size-4" />
                  ) : (
                    <Download data-icon="inline-start" className="size-4" />
                  )}
                  <span className="inline-grid">
                    <span
                      className={`col-start-1 row-start-1 ${zipping || downloadSaved ? "invisible" : ""}`}
                      aria-hidden={zipping || downloadSaved}
                    >
                      Download folders
                    </span>
                    <span
                      className={`col-start-1 row-start-1 ${zipping ? "" : "invisible"}`}
                      aria-hidden={!zipping}
                    >
                      Packing folders…
                    </span>
                    <span
                      className={`col-start-1 row-start-1 ${downloadSaved ? "" : "invisible"}`}
                      aria-hidden={!downloadSaved}
                    >
                      Saved
                    </span>
                  </span>
                </Button>
              </div>
            </div>
          ) : null}

          {finishedEmpty ? (
            <div className="mt-6 max-w-lg">
              <h2 className="text-[2.15rem] leading-none font-semibold tracking-[-0.04em]">
                Nothing landed.
              </h2>
            </div>
          ) : null}

          <div className={cn("max-w-lg", settled || finishedEmpty ? "mt-6" : "mt-7")}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label
                data-folder-picker
                className={cn(
                  buttonVariants({ size: "lg", variant: settled ? "outline" : "default" }),
                  "media-picker h-11 cursor-pointer rounded-2xl px-4 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                  settled && "border-[#c9d4c6] bg-[#f3f5ef] text-[#3c443e]",
                )}
                onDragOverCapture={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDropCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onDrop(event);
                }}
              >
                <span className="pointer-events-none">Choose files or folder</span>
                <input
                  id="folder-file-input"
                  ref={setFolderInput}
                  type="file"
                  name="folder"
                  multiple
                  aria-label="Choose files or folder"
                  className="media-picker-input"
                  onChange={onDirectory}
                  {...{ webkitdirectory: "", directory: "" }}
                />
              </label>
              {settled || finishedEmpty ? (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="h-10 gap-1.5 rounded-2xl border-[#c9d4c6] bg-[#f3f5ef] px-3.5 text-[#3c443e]"
                  onClick={resetBoard}
                >
                  <RefreshCw data-icon="inline-start" className="size-4" />
                  Sort another set
                </Button>
              ) : null}
              <button
                type="button"
                onClick={onSample}
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] leading-none font-normal text-[#6e7f68] shadow-none underline-offset-4 hover:text-[#3c443e] hover:underline focus-visible:underline focus-visible:outline-none"
              >
                Try a sample folder
              </button>
            </div>
          </div>

          {sorting && statusLine ? (
            <div className="mt-6 max-w-lg">
              <p
                className="status-line text-sm text-[#5a645c]"
                aria-live="polite"
                data-status-line={statusLine}
              >
                {showSortFlock ? <SortFlock /> : null}
                <span>{statusLine}</span>
              </p>
            </div>
          ) : null}

          {state.notice ? (
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#4f5c48]" role="status">
              {state.notice}
            </p>
          ) : null}
          {state.error ? (
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#5c5348]" role="alert">
              {state.error}
            </p>
          ) : null}
          <SkipLine
            skipped={state.skipped}
            unreadable={state.unreadable}
            decodeFailures={state.decodeFailures}
          />
        </header>
        <div className="board-scroll min-h-0 min-w-0 flex-1 overflow-y-auto" data-board-scroll>
          <CategoryBoard
            categories={state.categories}
            settled={settled}
            openCategoryId={openCategoryId}
            onOpen={setOpenCategoryId}
            onClose={closeCategory}
            onMove={onMoveTile}
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
          dockScale={flight.dockScale}
          layer={flight.layer}
          duration={flight.duration}
          onDone={() => onFlightLand(flight)}
        />
      ))}
    </div>
  );
}

/** A mint firefly scans four sage dots and melts through them. */
function SortFlock() {
  return (
    <span className="sort-flock" data-sort-flock="firefly" aria-hidden="true">
      <svg className="sort-goo-svg" aria-hidden="true" focusable="false">
        <filter
          id="sort-goo"
          x="-40%"
          y="-90%"
          width="180%"
          height="280%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8"
            result="goo"
          />
        </filter>
      </svg>
      <span className="sort-firefly">
        <span className="sort-scan sort-scan-glow" />
        <span className="sort-balls" style={{ filter: "url(#sort-goo)" }}>
          <span className="sort-ball" />
          <span className="sort-ball" />
          <span className="sort-ball" />
          <span className="sort-ball" />
          <span className="sort-scan" />
        </span>
      </span>
    </span>
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
  return <p className="mt-3 max-w-lg text-sm text-[#5f6a62]">{parts.join(" ")}</p>;
}
