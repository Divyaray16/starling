"use client";

import { MediaTile } from "@/components/media-tile";
import { flockLayout, flockLook } from "@/lib/flock";
import type { QueueItem } from "@/lib/types";
import { useLayoutEffect, useRef, useState } from "react";

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function FlockStage({
  items,
  batchCount,
  dragOver,
  lifting,
  landed,
  breathing,
}: {
  items: QueueItem[];
  /** Readable files in this batch. The pile lays out for all of them. */
  batchCount: number;
  dragOver: boolean;
  lifting: boolean;
  landed: boolean;
  breathing: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [heldCount, setHeldCount] = useState(0);
  const [placed, setPlaced] = useState<string[]>([]);
  const known = new Set(placed);
  const continuing = items.length > 0 && items.some((item) => known.has(item.id));
  let places = placed;
  if (!continuing) {
    const fresh = items.map((item) => item.id);
    if (!sameIds(fresh, placed)) places = fresh;
  } else {
    const added = items.filter((item) => !known.has(item.id));
    if (added.length > 0) places = [...placed, ...added.map((item) => item.id)];
  }
  if (places !== placed) setPlaced(places);
  const slotOf = new Map(places.map((id, index) => [id, index]));
  const layoutCount =
    items.length === 0
      ? 0
      : continuing
        ? Math.max(heldCount, items.length, batchCount)
        : Math.max(items.length, batchCount);
  if (layoutCount !== heldCount) setHeldCount(layoutCount);
  const pileOpen = items.length > 0;

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setBox((prev) =>
        prev.w === rect.width && prev.h === rect.height ? prev : { w: rect.width, h: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pileOpen]);

  const eyebrow = landed ? "Settled" : lifting ? "In the air" : "Unsorted";
  const title = landed ? "Landed" : lifting ? "Lifting" : "The pile";
  const countNumber = items.length === 0 ? 0 : layoutCount;
  const count =
    countNumber === 0 ? null : countNumber === 1 ? "1 together" : `${countNumber} together`;
  const layout =
    box.w > 0 && box.h > 0 && layoutCount > 0 ? flockLayout(layoutCount, box.w, box.h) : null;

  return (
    <section
      className={`flock-stage relative flex h-[46vh] min-h-[300px] flex-col overflow-hidden md:h-auto md:min-h-0 md:w-[46%] md:shrink-0 ${
        dragOver ? "flock-stage-hot" : ""
      }`}
      data-flock-stage
      data-flock-count={items.length}
      data-breathing={breathing ? "true" : "false"}
      aria-label="Unsorted pile"
    >
      <header className="z-10 flex shrink-0 items-end justify-between px-6 pt-6 pb-1 sm:px-8">
        <div>
          <p className="text-[11px] font-medium tracking-[0.18em] text-[#7a857c] uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-[1.85rem] leading-none font-semibold tracking-[-0.04em] text-[#3c443e]">
            {title}
          </h2>
        </div>
        {count ? <p className="text-sm text-[#5f6a62] tabular-nums">{count}</p> : null}
      </header>

      <div className="relative mx-4 mt-2 mb-4 flex min-h-0 flex-1 flex-col sm:mx-6 sm:mb-6" data-pile>
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            {landed ? (
              <p className="max-w-xs text-center text-[15px] leading-relaxed text-[#4a524c]">
                The pile lifted together. It is in the rows now.
              </p>
            ) : lifting ? (
              <p className="sr-only">The flock is in the air.</p>
            ) : (
              <p className="max-w-xs text-center text-[15px] leading-relaxed text-[#4a524c]">
                Drop photos and videos here.
              </p>
            )}
          </div>
        ) : (
          <div
            ref={frameRef}
            className="relative min-h-0 flex-1"
            data-pile-cards={items.length}
            data-pile-ready={layout ? "true" : "false"}
          >
            {layout
              ? items.map((item, index) => {
                  const look = flockLook(item.id, slotOf.get(item.id) ?? index, layout);
                  const breathePx = -3;
                  const breatheDuration = (2.8 + ((look.duration - 3.6) / 2.4) * 0.8).toFixed(2);
                  const breatheDelay = (look.delay + index * 0.17).toFixed(2);
                  return (
                    <div
                      key={item.id}
                      data-flock-id={item.id}
                      data-breathe={breathing ? "true" : "false"}
                      className="flock-tile absolute"
                      style={{
                        left: `${look.x}%`,
                        top: `${look.y}%`,
                        width: look.size,
                        zIndex: look.z,
                        transform: `translate(-50%, -50%) rotate(${look.tilt}deg)`,
                        ["--drift-x" as string]: `${look.driftX}px`,
                        ["--drift-y" as string]: `${look.driftY}px`,
                        ["--drift-duration" as string]: `${look.duration}s`,
                        ["--drift-delay" as string]: `${look.delay}s`,
                        ["--breathe" as string]: `${breathePx}px`,
                        ["--breathe-duration" as string]: `${breatheDuration}s`,
                        ["--breathe-delay" as string]: `${breatheDelay}s`,
                      }}
                    >
                      <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
                    </div>
                  );
                })
              : null}
          </div>
        )}
      </div>
    </section>
  );
}
