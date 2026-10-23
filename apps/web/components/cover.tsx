import { cn } from "@cohory/ui/lib/utils";
import { StoredImage } from "./stored-image";

export function CommunityCover({
  name,
  coverUrl,
  className,
}: {
  name: string;
  coverUrl: string | null;
  className?: string;
}) {
  if (coverUrl) {
    return (
      // Cover images come from the storage driver's public URL, which may be any S3 host.
      <StoredImage
        src={coverUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("w-full object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn("flex w-full items-center justify-center bg-accent-muted", className)}
    >
      <span className="text-3xl font-semibold text-accent">
        {name.trim()[0]?.toUpperCase() ?? "?"}
      </span>
    </div>
  );
}
