import type { CommunityRole } from "@cohory/authz";
import { cn } from "@cohory/ui/lib/utils";

const labels: Record<CommunityRole, string | null> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Mod",
  member: null,
};

export function RoleBadge({ role, className }: { role: CommunityRole | null; className?: string }) {
  const label = role ? labels[role] : null;
  if (!label) {
    return null;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-text",
        className,
      )}
    >
      {label}
    </span>
  );
}
