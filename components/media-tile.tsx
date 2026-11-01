import { Badge } from "@/components/ui/badge";
import type { MediaKind } from "@/lib/types";
import { cn } from "cn";

export function MediaTile({
  src,
  name,
  kind,
  className,
  framed = true,
}: {
  src: string;
  name: string;
  kind: MediaKind;
  className?: string;
  framed?: boolean;
}) {
  return (
    <figure
      className={cn(
        "relative",
        framed &&
          "overflow-hidden rounded-[1.15rem] bg-[#f4f6f1] p-1 shadow-[0_14px_32px_rgba(70,90,75,0.14),0_2px_8px_rgba(70,90,75,0.06)]",
        className,
      )}
    >
      <div className="relative">
        {/* Blob and object URLs are local files; next/image cannot optimize them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          draggable={false}
          className="aspect-[4/5] h-full w-full rounded-[0.85rem] object-cover"
        />
        <Badge
          variant="secondary"
          className="absolute bottom-1.5 left-1.5 h-4 border-0 bg-[#6e7f68]/90 px-1.5 text-[10px] tracking-wide text-[#f4f7f2] uppercase"
        >
          {kind === "video" ? "Video" : "Photo"}
        </Badge>
      </div>
    </figure>
  );
}
