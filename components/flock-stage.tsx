"use client";

import { MediaTile } from "@/components/media-tile";
import { FLOCK_VISIBLE, flockLook } from "@/lib/flock";
import type { QueueItem } from "@/lib/types";

export function FlockStage({
  items,
  dragOver,
  lifting,
  landed,
  breathing,
}: {
  items: QueueItem[];
  dragOver: boolean;
  lifting: boolean;
  landed: boolean;
  breathing: boolean;
}) {
  const visible = items.slice(0, FLOCK_VISIBLE);
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
        {visible.length === 0 ? (
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
          <div className="relative min-h-0 flex-1">
            {visible.map((item, index) => {
              const look = flockLook(item.id);
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
            })}
            {hidden > 0 ? (
              <p className="absolute right-3 bottom-2 left-3 text-xs text-[#5f6a62]">
                {visible.length} on screen, {items.length} in the pile.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
