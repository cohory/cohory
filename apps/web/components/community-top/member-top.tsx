import type { CommunityRole } from "@cohory/authz";
import { Button } from "@cohory/ui";
import { Settings2 } from "lucide-react";
import Link from "next/link";

import { CommunityMenu } from "../community-menu";
import { RoleBadge } from "../role-badge";
import { CommunityMeta } from "./community-meta";

export interface MemberTopProps {
  slug: string;
  name: string;
  memberCount: number;
  privacy: "public" | "private";
  role: CommunityRole | null;
  canManage: boolean;
  canLeave: boolean;
  paying?: boolean;
}

export function MemberTop({
  slug,
  name,
  memberCount,
  privacy,
  role,
  canManage,
  canLeave,
  paying = false,
}: MemberTopProps) {
  return (
    <div className="border-b border-border bg-surface md:border-b-0">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-text md:text-2xl">{name}</h1>
            <RoleBadge role={role} className="shrink-0" />
          </div>
          <CommunityMeta privacy={privacy} memberCount={memberCount} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage ? (
            <Button asChild variant="secondary" className="min-h-11">
              <Link href={`/c/${slug}/manage`}>
                <Settings2 aria-hidden="true" className="size-5" strokeWidth={1.5} />
                Manage
              </Link>
            </Button>
          ) : null}
          {canLeave ? (
            <CommunityMenu
              slug={slug}
              name={name}
              isPrivate={privacy === "private"}
              paying={paying}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
