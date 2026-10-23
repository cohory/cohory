import type { CommunityRole } from "@cohory/authz";
import { Badge } from "@cohory/ui";
import Link from "next/link";

import { memberCountLabel } from "../lib/format";
import { CommunityCover } from "./cover";
import { RoleBadge } from "./role-badge";

export interface MyCommunityCardProps {
  readonly community: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly coverUrl: string | null;
    readonly memberCount: number;
  };
  readonly role: CommunityRole | null;
  readonly unread: number;
}

export function MyCommunityCard({ community, role, unread }: MyCommunityCardProps) {
  const showRole = role === "owner" || role === "admin";
  return (
    <li className="flex min-w-0">
      <Link
        href={`/c/${community.slug}`}
        data-slot="my-community-card"
        className="flex w-full min-w-0 flex-col overflow-hidden rounded-(--card-radius) border border-border bg-surface outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <CommunityCover
          name={community.name}
          coverUrl={community.coverUrl}
          className="aspect-[4/1]"
        />
        <div className="flex flex-1 flex-col gap-1 p-4">
          <h2 className="truncate text-lg text-text">{community.name}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {showRole ? <RoleBadge role={role} /> : null}
            {unread > 0 ? (
              <Badge variant="accent">{unread > 99 ? "99+ new" : `${unread} new`}</Badge>
            ) : null}
            <span className="text-sm text-text-muted">
              {memberCountLabel(community.memberCount)}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
