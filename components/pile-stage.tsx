"use client";

import { MediaTile } from "@/components/media-tile";
import type { QueueItem } from "@/lib/types";

const VISIBLE_PILE = 16;

function tiltFor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return ((hash % 15) - 7) * 0.8;
}

export function PileStage({
  items,
  dragOver,
}: {
  items: QueueItem[];
  dragOver: boolean;
}) {
  const visible = items.slice(0, VISIBLE_PILE);
  const hidden = Math.max(0, items.length - visible.length);

  return (
    <section
      className="ink-stage relative flex h-[42vh] min-h-[280px] flex-col overflow-hidden md:h-auto md:w-[42%] md:shrink-0"
      data-pile-stage
      aria-label="Unsorted pile"
    >
      <div
        className={`pointer-events-none absolute inset-3 rounded-sm border transition-colors ${
          dragOver ? "border-[#c46b45]" : "border-transparent"
        }`}
      />
      <header className="z-10 flex shrink-0 items-end justify-between px-5 pt-5 pb-3 sm:px-6">
        <div>
          <p className="text-[11px] tracking-[0.18em] text-[#c46b45] uppercase">Unsorted</p>
          <h2 className="mt-1 font-serif text-[1.7rem] leading-none text-[#f6efe6]">The pile</h2>
        </div>
        <p className="text-sm text-[#d7c4b4] tabular-nums">
          {items.length === 0 ? "Empty" : `${items.length} still here`}
        </p>
      </header>

      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 pb-10">
          <div className="max-w-xs text-center">
            <div className="mx-auto mb-5 flex h-24 items-end justify-center gap-3 opacity-70" aria-hidden>
              <span className="block h-16 w-12 -rotate-6 border border-[#c46b45]/40 bg-[#2a211c]" />
              <span className="block h-20 w-14 rotate-2 border border-[#e7d3c4]/30 bg-[#241c18]" />
              <span className="block h-14 w-12 rotate-6 border border-[#c46b45]/30 bg-[#2a211c]" />
            </div>
            <p className="text-sm leading-relaxed text-[#e6d5c6]">
              Drop a folder here. Photos and videos wait on this table until each one is labeled.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden px-5 pt-4 pb-6 sm:px-6">
          <div className="columns-2 gap-x-3 sm:columns-3">
            {visible.map((item) => (
              <div
                key={item.id}
                data-pile-id={item.id}
                className="mb-3 break-inside-avoid"
                style={{ transform: `rotate(${tiltFor(item.id)}deg)` }}
              >
                <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
              </div>
            ))}
          </div>
          {hidden > 0 ? (
            <p className="mt-2 text-xs text-[#d7c4b4]">
              Showing {visible.length} of {items.length} still unsorted.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
