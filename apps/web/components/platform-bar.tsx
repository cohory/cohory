import { canCreateCommunities, getPlatformConfig } from "@cohory/config/platform";
import { getNotificationsService } from "@cohory/notifications";
import { Button } from "@cohory/ui";
import Link from "next/link";
import { Suspense } from "react";

import { actorFor } from "../lib/actor";
import { loadMyCommunities } from "../lib/communities/my-communities";
import { earlyAccessLinkFor } from "../lib/early-access/service";
import { currentSession } from "../lib/session";
import { NotificationBellClient } from "./feed/notification-bell";
import { HeaderSearch, HeaderSearchPlaceholder } from "./header-search";
import { PlatformBrand, type PlatformBrandCommunity } from "./platform-brand";
import { UserMenu } from "./user-menu";

export async function PlatformBar({
  community = null,
  searchable = false,
}: {
  community?: PlatformBrandCommunity | null;
  searchable?: boolean;
}) {
  const session = await currentSession();
  const config = getPlatformConfig();
  const [communities, unread] = session
    ? await Promise.all([
        loadMyCommunities(),
        getNotificationsService()
          .unreadCount(actorFor(session))
          .catch(() => 0),
      ])
    : [null, 0];

  return (
    <header className="sticky top-0 z-(--z-header) border-b border-border bg-surface">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center">
          <PlatformBrand community={community} instance={config.instance} />
        </div>
        <nav aria-label="Account" className="flex shrink-0 items-center gap-1 md:gap-2">
          {community && searchable ? (
            <Suspense fallback={<HeaderSearchPlaceholder />}>
              <HeaderSearch slug={community.slug} name={community.name} />
            </Suspense>
          ) : null}
          {session ? (
            <>
              <NotificationBellClient initialUnread={unread} />
              <UserMenu
                name={session.user.name}
                email={session.user.email}
                image={session.user.image ?? null}
                currentSlug={community?.slug ?? null}
                canCreate={canCreateCommunities(config.communityCreation, session.user.email)}
                earlyAccessHref={earlyAccessLinkFor(session.user.email)}
                communities={(communities ?? []).map((row) => ({
                  slug: row.community.slug,
                  name: row.community.name,
                  unread: row.unread,
                }))}
              />
            </>
          ) : (
            <Button asChild variant="secondary" className="min-h-11">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
