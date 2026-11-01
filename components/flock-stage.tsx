"use client";

import { MediaTile } from "@/components/media-tile";
import { flockLook } from "@/lib/flock";
import type { QueueItem } from "@/lib/types";

const VISIBLE_CLOUD = 72;

export function FlockStage({
  items,
  dragOver,
  lifting,
  landed,
}: {
  items: QueueItem[];
  dragOver: boolean;
  lifting: boolean;
  landed: boolean;
}) {
  const visible = items.slice(0, VISIBLE_CLOUD);
  const hidden = Math.max(0, items.length - visible.length);
  const eyebrow = landed ? "Settled" : lifting ? "In the air" : "Unsorted";
  const title = landed ? "Landed" : lifting ? "Lifting" : "The pile";
  const count =
    items.length === 0 ? null : items.length === 1 ? "1 together" : `${items.length} together`;

  return (
    <section
      className={`flock-stage relative flex h-[46vh] min-h-[300px] flex-col overflow-hidden md:h-auto md:min-h-0 md:w-[46%] md:shrink-0 ${
        dragOver ? "flock-stage-hot" : ""
      }`}
      data-flock-stage
      data-flock-count={items.length}
      aria-label="Unsorted pile"
    >
      <header className="z-10 flex shrink-0 items-end justify-between px-6 pt-6 pb-2 sm:px-8">
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

      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 pb-10">
          <div className="max-w-xs text-center">
            {landed ? (
              <p className="text-[15px] leading-relaxed text-[#4a524c]">
                The pile lifted together. It is in the rows now.
              </p>
            ) : lifting ? (
              <p className="sr-only">The flock is in the air.</p>
            ) : (
              <>
                <div className="mx-auto mb-6 flex h-28 items-end justify-center" aria-hidden>
                  <span className="block h-16 w-12 -translate-y-1 -rotate-12 bg-[#f4f6f1] shadow-[0_12px_24px_rgba(70,90,75,0.12)]" />
                  <span className="z-10 -mx-3 block h-24 w-16 -rotate-2 bg-[#f7f8f4] shadow-[0_16px_30px_rgba(70,90,75,0.14)]" />
                  <span className="block h-[4.5rem] w-12 translate-y-1 rotate-6 bg-[#f4f6f1] shadow-[0_12px_24px_rgba(70,90,75,0.12)]" />
                </div>
                <p className="text-[15px] leading-relaxed text-[#4a524c]">
                  Drop photos and videos here. They wait as one pile, then lift together.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="relative mx-4 my-3 min-h-0 flex-1 sm:mx-8">
          {visible.map((item) => {
            const look = flockLook(item.id);
            return (
              <div
                key={item.id}
                data-flock-id={item.id}
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
                }}
              >
                <MediaTile src={item.thumbUrl} name={item.name} kind={item.kind} />
              </div>
            );
          })}
          {hidden > 0 ? (
            <p className="absolute right-6 bottom-4 left-6 text-xs text-[#5f6a62]">
              {visible.length} on screen, {items.length} in the pile.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
