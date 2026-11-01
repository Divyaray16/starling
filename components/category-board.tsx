"use client";

import { MediaTile } from "@/components/media-tile";
import { Button } from "@/components/ui/button";
import type { CategoryRow } from "@/lib/types";
import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

function countLabel(count: number) {
  if (count === 0) return "Landing";
  return `${count} ${count === 1 ? "file" : "files"}`;
}

export function CategoryBoard({
  categories,
  sorting,
  settled,
  finishedEmpty = false,
  openCategoryId,
  onOpen,
  onClose,
}: {
  categories: CategoryRow[];
  sorting: boolean;
  settled: boolean;
  finishedEmpty?: boolean;
  openCategoryId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const open = categories.find((category) => category.id === openCategoryId) ?? null;

  if (open && settled) {
    return <CategoryGrid category={open} onClose={onClose} />;
  }

  if (categories.length === 0) {
    return (
      <LandingSurface>
        <div className="px-5 py-8 sm:px-7 sm:py-10">
          <h2 className="max-w-md text-[2.35rem] leading-[1.05] font-semibold tracking-[-0.04em] text-[#3c443e]">
            {finishedEmpty ? "Nothing landed" : "Nothing is sorted yet"}
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#5a645c]">
            {finishedEmpty
              ? "Those files couldn’t be read, so the flock had nowhere to go."
              : "Choose photos and videos, or try the sample set. Starling reads each file in this browser and keeps it on this machine. A category appears only when a file lands in it."}
          </p>
          {sorting ? (
            <p className="mt-6 text-sm text-[#6b756c]">The flock is still together.</p>
          ) : null}
        </div>
      </LandingSurface>
    );
  }

  return (
    <LandingSurface>
      <ul className="divide-y divide-[#c5d2c8]">
        {categories.map((category) => (
          <CategoryLine key={category.id} category={category} settled={settled} onOpen={onOpen} />
        ))}
      </ul>
    </LandingSurface>
  );
}

function LandingSurface({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 pt-1 pb-8 sm:px-10 sm:pb-10">
      <div className="landing-surface">{children}</div>
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
  onOpen,
}: {
  category: CategoryRow;
  settled: boolean;
  onOpen: (id: string) => void;
}) {
  const warm = useLandingWarmth(category.items.length);
  const body = (
    <>
      <div className="flex items-center justify-between gap-4">
        <h3 className="min-w-0 truncate text-[1.65rem] leading-none font-semibold tracking-[-0.03em] text-[#3c443e]">
          {category.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5 text-sm text-[#5f6a62]">
          <CountTick count={category.items.length} />
          {settled ? (
            <span className="category-open" aria-hidden="true">
              <ArrowUpRight className="size-4" />
            </span>
          ) : null}
        </div>
      </div>
      <div
        data-dock={category.id}
        data-count={category.items.length}
        className="mt-3 flex min-h-[92px] gap-2 overflow-x-auto pb-1"
      >
        <DockSlots category={category} />
      </div>
    </>
  );

  return (
    <li
      className="category-row category-enter relative rounded-2xl"
      data-category={category.id}
      data-warm={warm ? "true" : "false"}
      data-openable={settled ? "true" : "false"}
    >
      {settled ? (
        <button
          type="button"
          className="category-row-hit rounded-2xl px-2 py-4"
          aria-label={`View ${category.name}`}
          onClick={() => onOpen(category.id)}
        >
          {body}
        </button>
      ) : (
        <div className="category-row-hit rounded-2xl px-2 py-4">{body}</div>
      )}
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
    .filter((item): item is CategoryRow["items"][number] => item !== undefined);
}

function DockSlots({ category }: { category: CategoryRow }) {
  const landed = new Map(category.items.map((item) => [item.id, item]));
  return dockOrder(category).map((id) => {
    const item = landed.get(id);
    if (!item) {
      return (
        <div key={id} data-dock-slot={id} aria-hidden className="w-[76px] shrink-0 p-1 invisible">
          <div className="aspect-[4/5] w-full" />
        </div>
      );
    }
    return (
      <div key={id} data-dock-slot={id} data-landed={id} className="w-[76px] shrink-0">
        <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
      </div>
    );
  });
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
  onClose,
}: {
  category: CategoryRow;
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
    <div className="px-6 py-6 sm:px-10" role="region" aria-label={`${category.name} photos`}>
      <Button type="button" variant="outline" className="h-10 gap-1.5 rounded-2xl border-[#c9d4c6] bg-[#f3f5ef] px-3 text-[#3c443e]" onClick={onClose}>
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
            <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
            <p className="mt-2 truncate text-sm text-[#3c443e]">{item.name}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
