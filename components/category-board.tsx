"use client";

import { MediaTile } from "@/components/media-tile";
import { Button } from "@/components/ui/button";
import type { CategoryRow, LandedTile } from "@/lib/types";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function countLabel(count: number) {
  if (count === 0) return "Landing";
  return `${count} ${count === 1 ? "file" : "files"}`;
}

const DRAG_SLOP = 5;

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  item: LandedTile;
  categoryId: string;
  moved: boolean;
};

function categoryAtPoint(x: number, y: number): string | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    if (node.closest("[data-drag-ghost]")) continue;
    const row = node.closest("[data-category]");
    if (row instanceof HTMLElement && row.dataset.category) return row.dataset.category;
  }
  return null;
}

function ghostTransform(x: number, y: number) {
  return `translate3d(${x}px, ${y}px, 0) translate(-50%, -58%) rotate(-3deg)`;
}

function nudgeBoardScroll(clientY: number) {
  const scroller = document.querySelector("[data-board-scroll]");
  if (!(scroller instanceof HTMLElement)) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 36;
  if (clientY > rect.bottom - edge) scroller.scrollTop += 14;
  else if (clientY < rect.top + edge) scroller.scrollTop -= 14;
}

type Ghost = { item: LandedTile; x: number; y: number };

function useTileDrag(
  enabled: boolean,
  onMove: (itemId: string, fromCategoryId: string, toCategoryId: string) => void,
) {
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef(false);
  const stopListeners = useRef<(() => void) | null>(null);
  const enabledRef = useRef(enabled);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    return () => {
      stopListeners.current?.();
      document.body.classList.remove("tile-grabbing");
    };
  }, []);

  function finish(commit: boolean, x: number, y: number) {
    const current = session.current;
    session.current = null;
    stopListeners.current?.();
    stopListeners.current = null;
    document.body.classList.remove("tile-grabbing");
    if (!current) return;
    if (current.moved) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 120);
      if (commit) {
        const hit = categoryAtPoint(x, y);
        if (hit && hit !== current.categoryId) onMove(current.item.id, current.categoryId, hit);
      }
    }
    setGhost(null);
    setOverId(null);
  }

  function onPointerDown(event: React.PointerEvent<HTMLElement>, item: LandedTile, categoryId: string) {
    if (!enabledRef.current || event.button !== 0 || session.current) return;
    const pointerId = event.pointerId;
    session.current = {
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      item,
      categoryId,
      moved: false,
    };
    const move = (ev: PointerEvent) => {
      const current = session.current;
      if (!current || ev.pointerId !== pointerId) return;
      const dx = ev.clientX - current.startX;
      const dy = ev.clientY - current.startY;
      if (!current.moved) {
        if (dx * dx + dy * dy < DRAG_SLOP * DRAG_SLOP) return;
        current.moved = true;
        document.body.classList.add("tile-grabbing");
      }
      ev.preventDefault();
      setGhost({ item: current.item, x: ev.clientX, y: ev.clientY });
      const hit = categoryAtPoint(ev.clientX, ev.clientY);
      setOverId((prev) => (prev === hit ? prev : hit));
      nudgeBoardScroll(ev.clientY);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      finish(true, ev.clientX, ev.clientY);
    };

    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      finish(false, ev.clientX, ev.clientY);
    };

    // Listen on the window, not the thumbnail. A captured thumb is cancelled
    // once the open grid scrolls it out of view, which would drop the drag.
    window.addEventListener("pointermove", move, { passive: false, capture: true });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    stopListeners.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  }

  return { ghost, overId, suppressClick, onPointerDown };
}

type TileDrag = ReturnType<typeof useTileDrag>;

export function CategoryBoard({
  categories,
  settled,
  openCategoryId,
  onOpen,
  onClose,
  onMove,
}: {
  categories: CategoryRow[];
  settled: boolean;
  openCategoryId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onMove: (itemId: string, fromCategoryId: string, toCategoryId: string) => void;
}) {
  const drag = useTileDrag(settled, onMove);

  useEffect(() => {
    if (!openCategoryId) return;
    const alive = categories.some(
      (category) => category.id === openCategoryId && category.items.length > 0,
    );
    if (!alive) onClose();
  }, [categories, openCategoryId, onClose]);

  const open = categories.find((category) => category.id === openCategoryId) ?? null;

  let body: ReactNode = null;
  if (open && settled) {
    body = (
      <CategoryGrid
        category={open}
        others={categories.filter((category) => category.id !== open.id)}
        drag={drag}
        onOpen={onOpen}
        onClose={onClose}
      />
    );
  } else if (categories.length > 0) {
    body = (
      <LandingSurface>
        <ul className="divide-y divide-[#c5d2c8]">
          {categories.map((category) => (
            <CategoryLine
              key={category.id}
              category={category}
              settled={settled}
              drop={drag.overId === category.id}
              drag={drag}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </LandingSurface>
    );
  }

  return (
    <>
      {body}
      {drag.ghost
        ? createPortal(
            <div
              data-drag-ghost
              aria-hidden
              className="drag-ghost"
              style={{ transform: ghostTransform(drag.ghost.x, drag.ghost.y) }}
            >
              <MediaTile
                src={drag.ghost.item.thumbUrl}
                name={drag.ghost.item.name}
                kind={drag.ghost.item.kind}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function LandingSurface({ children, inset = true }: { children: ReactNode; inset?: boolean }) {
  return (
    <div className={inset ? "px-6 pt-1 pb-8 sm:px-10 sm:pb-10" : ""}>
      <div className="landing-surface" data-landing-tray>
        {children}
      </div>
    </div>
  );
}

function useLandingWarmth(count: number) {
  const [warm, setWarm] = useState(false);
  const previous = useRef(count);
  useEffect(() => {
    if (count <= previous.current) {
      previous.current = count;
      return;
    }
    previous.current = count;
    setWarm(true);
    const timer = window.setTimeout(() => setWarm(false), 640);
    return () => window.clearTimeout(timer);
  }, [count]);
  return warm;
}

function CategoryLine({
  category,
  settled,
  drop,
  drag,
  onOpen,
}: {
  category: CategoryRow;
  settled: boolean;
  drop: boolean;
  drag: TileDrag;
  onOpen: (id: string) => void;
}) {
  const warm = useLandingWarmth(category.items.length);
  const order = dockOrder(category);
  const landed = new Map(category.items.map((item) => [item.id, item]));
  const coverId = order[0];
  const rest = order.slice(1);

  function openRow() {
    if (drag.suppressClick.current) return;
    onOpen(category.id);
  }

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRow();
  }

  return (
    <li
      className="category-row category-enter relative rounded-2xl"
      data-category={category.id}
      data-count={category.items.length}
      data-warm={warm ? "true" : "false"}
      data-openable={settled ? "true" : "false"}
      data-drop={drop ? "true" : "false"}
    >
      <div
        className="category-row-hit"
        role={settled ? "button" : undefined}
        tabIndex={settled ? 0 : undefined}
        aria-label={settled ? `View ${category.name}` : undefined}
        onClick={settled ? openRow : undefined}
        onKeyDown={settled ? onKey : undefined}
      >
        {coverId ? (
          <PhotoSlot
            id={coverId}
            cover
            item={landed.get(coverId)}
            categoryId={category.id}
            settled={settled}
            drag={drag}
          />
        ) : null}
        <h3 className="category-name">{category.name}</h3>
        <div className="category-count">
          <CountTick count={category.items.length} />
        </div>
        <div data-dock={category.id} data-count={category.items.length} className="category-strip">
          {rest.map((id) => (
            <PhotoSlot
              key={id}
              id={id}
              item={landed.get(id)}
              categoryId={category.id}
              settled={settled}
              drag={drag}
            />
          ))}
        </div>
        {settled ? (
          <span className="category-open" aria-hidden="true">
            <ArrowUpRight className="size-4" />
          </span>
        ) : null}
      </div>
    </li>
  );
}

function dockOrder(category: CategoryRow) {
  if (category.slots.length > 0) return category.slots;
  return category.items.map((item) => item.id);
}

function orderedItems(category: CategoryRow) {
  const landed = new Map(category.items.map((item) => [item.id, item]));
  return dockOrder(category)
    .map((id) => landed.get(id))
    .filter((item): item is LandedTile => item !== undefined);
}

function SlotHold() {
  return (
    <div className="slot-hold invisible" aria-hidden>
      <div className="relative overflow-hidden rounded-[1.15rem] p-1">
        <div className="relative">
          <div className="aspect-[4/5] w-full" />
        </div>
      </div>
    </div>
  );
}

function PhotoSlot({
  id,
  cover = false,
  item,
  categoryId,
  settled,
  drag,
}: {
  id: string;
  cover?: boolean;
  item: LandedTile | undefined;
  categoryId: string;
  settled: boolean;
  drag: TileDrag;
}) {
  return (
    <div
      data-dock-slot={id}
      data-cover={cover ? "true" : undefined}
      data-landed={item ? id : undefined}
      className={cover ? "cover-slot" : "dock-slot"}
    >
      {item ? (
        <div
          className={settled ? "thumb-grab" : undefined}
          data-tile={item.id}
          data-name={item.name}
          onPointerDown={(event) => drag.onPointerDown(event, item, categoryId)}
          onDragStart={(event) => event.preventDefault()}
        >
          <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
        </div>
      ) : (
        <SlotHold />
      )}
    </div>
  );
}

function CountTick({ count }: { count: number }) {
  return (
    <span key={count} className="count-tick inline-block tabular-nums">
      {countLabel(count)}
    </span>
  );
}

function CategoryGrid({
  category,
  others,
  drag,
  onOpen,
  onClose,
}: {
  category: CategoryRow;
  others: CategoryRow[];
  drag: TileDrag;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="px-6 py-6 sm:px-10" role="region" aria-label={`${category.name} photos`} data-grid={category.id}>
      <Button
        type="button"
        variant="outline"
        className="h-10 gap-1.5 rounded-2xl border-[#c9d4c6] bg-[#f3f5ef] px-3 text-[#3c443e]"
        onClick={onClose}
      >
        <X data-icon="inline-start" className="size-4" />
        Close
      </Button>
      <h2 className="mt-5 text-[2.2rem] leading-none font-semibold tracking-[-0.04em] text-[#3c443e]">
        {category.name}
      </h2>
      <p className="mt-2 text-sm text-[#5f6a62]">{countLabel(category.items.length)}</p>
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {orderedItems(category).map((item) => (
          <li key={item.id} className="min-w-0">
            <div
              className="thumb-grab"
              data-tile={item.id}
              data-name={item.name}
              onPointerDown={(event) => drag.onPointerDown(event, item, category.id)}
              onDragStart={(event) => event.preventDefault()}
            >
              <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
            </div>
            <p className="mt-2 truncate text-sm text-[#3c443e]">{item.name}</p>
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <div className="mt-8">
          <p className="mb-3 text-[13px] text-[#7a857c]">Other categories</p>
          <LandingSurface inset={false}>
            <ul className="divide-y divide-[#c5d2c8]">
              {others.map((other) => (
                <CategoryLine
                  key={other.id}
                  category={other}
                  settled
                  drop={drag.overId === other.id}
                  drag={drag}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </LandingSurface>
        </div>
      ) : null}
    </div>
  );
}
