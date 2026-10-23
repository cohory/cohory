import { Globe, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { memberCountLabel } from "../../lib/format";

export function CommunityMeta({
  privacy,
  memberCount,
  children,
}: {
  privacy: "public" | "private";
  memberCount: number;
  children?: ReactNode;
}) {
  const PrivacyIcon = privacy === "private" ? Lock : Globe;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
      <span className="inline-flex items-center gap-1">
        <PrivacyIcon aria-hidden="true" className="size-4" strokeWidth={1.5} />
        {privacy === "private" ? "Private" : "Public"}
      </span>
      <span aria-hidden="true">·</span>
      <span>{memberCountLabel(memberCount)}</span>
      {children ? (
        <>
          <span aria-hidden="true">·</span>
          {children}
        </>
      ) : null}
    </p>
  );
}
