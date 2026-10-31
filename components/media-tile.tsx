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
        "relative overflow-hidden",
        framed && "bg-[#f4efe6] p-1 pb-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)]",
        className,
      )}
    >
      {/* Blob and object URLs are local files; next/image cannot optimize them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} className="aspect-[4/5] h-full w-full object-cover" />
      <Badge
        variant="secondary"
        className={cn(
          "absolute bottom-1.5 left-1.5 h-4 border-0 px-1.5 text-[10px] tracking-wide uppercase",
          kind === "video"
            ? "bg-[#c46b45] text-[#fff7f2]"
            : "bg-[#1c1612]/80 text-[#f6efe6]",
        )}
      >
        {kind === "video" ? "Video" : "Photo"}
      </Badge>
    </figure>
  );
}
