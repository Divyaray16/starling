"use client";

import { MediaTile } from "@/components/media-tile";
import type { CategoryRow } from "@/lib/types";

export function CategoryRail({
  categories,
  sorting,
}: {
  categories: CategoryRow[];
  sorting: boolean;
}) {
  if (categories.length === 0) {
    return (
      <div className="px-6 py-8 sm:px-8">
        <h2 className="max-w-md font-serif text-[2.4rem] leading-[1.05] text-[#241c17]">
          Nothing is sorted yet
        </h2>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#5c5148]">
          Pick a folder of photos and videos, or try the sample set. Divya reads each file in this
          browser and moves it out of the pile. A category appears only when a file lands in it.
          Adding different pictures can bring in a category that was not here before.
        </p>
        {sorting ? (
          <>
            <p className="mt-6 text-sm text-[#6e6258]">The first file has not landed yet.</p>
            <div data-dock="incoming" className="h-8 w-28" aria-hidden />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="px-6 pb-10 sm:px-8">
      <ul className="divide-y divide-[#e4d8c8]">
        {categories.map((category) => (
          <li key={category.id} className="category-enter py-4">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-serif text-[1.65rem] leading-none text-[#241c17]">
                {category.name}
              </h3>
              <p className="text-sm text-[#c46b45] tabular-nums">
                {category.items.length} {category.items.length === 1 ? "file" : "files"}
              </p>
            </div>
            <div
              data-dock={category.id}
              className="mt-3 flex gap-2 overflow-x-auto pb-1"
            >
              {category.items.map((item) => (
                <div key={item.id} className="w-[76px] shrink-0">
                  <MediaTile
                    src={item.thumbUrl}
                    name={item.name}
                    kind={item.kind}
                    className="shadow-[0_6px_16px_rgba(60,40,20,0.12)]"
                  />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {sorting ? <div data-dock="incoming" className="h-8 w-28" aria-hidden /> : null}
    </div>
  );
}
