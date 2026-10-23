import { Avatar, AvatarFallback, AvatarImage } from "../primitives/avatar";
import { cn } from "../lib/utils";

interface AuthorAvatarProps {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function AuthorAvatar({ name, avatarUrl, className }: AuthorAvatarProps) {
  return (
    <Avatar className={cn("size-10", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-accent" aria-hidden="true">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export { AuthorAvatar, type AuthorAvatarProps };
