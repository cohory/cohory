import { AuthorAvatar } from "../community/author-avatar";
import { cn } from "../lib/utils";
import type { EventGoingFace } from "./types";

interface GoingFacesProps {
  faces: readonly EventGoingFace[];
  size?: "sm" | "md";
  className?: string;
}

function GoingFaces({ faces, size = "md", className }: GoingFacesProps) {
  if (faces.length === 0) return null;
  const names = faces.map((face) => face.name).join(", ");
  return (
    <ul
      data-slot="going-faces"
      aria-label={`Going: ${names}`}
      className={cn("flex items-center -space-x-2", className)}
    >
      {faces.map((face) => (
        <li key={face.userId} title={face.name}>
          <AuthorAvatar
            name={face.name}
            avatarUrl={face.image}
            className={cn("ring-2 ring-surface", size === "sm" ? "size-6" : "size-8")}
          />
        </li>
      ))}
    </ul>
  );
}

export { GoingFaces, type GoingFacesProps };
