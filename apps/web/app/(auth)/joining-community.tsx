import { CommunityMark } from "@cohory/ui";

export function JoiningCommunity({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-text">
      <CommunityMark name={name} logoUrl={logoUrl} className="size-8 rounded-md text-sm" />
      <span className="min-w-0 truncate">{name}</span>
    </p>
  );
}
