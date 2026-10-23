import { getPostsService } from "@cohory/api/services";
import { getApprovalsService } from "@cohory/agents/approvals";
import { can, type Actor, type CommunityRole } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { getReviewsService } from "@cohory/reviews";
import { cache } from "react";
import { logger } from "@cohory/infra/logger";

export const inboxTabs = ["requests", "reports", "approvals"] as const;

export type InboxTab = (typeof inboxTabs)[number];

export const inboxTabLabels: Readonly<Record<InboxTab, string>> = {
  requests: "Requests",
  reports: "Reports",
  approvals: "Agent approvals",
};

export interface InboxViewer {
  readonly actor: Actor;
  readonly role: CommunityRole;
}

export type InboxCounts = Readonly<Partial<Record<InboxTab, number>>>;

export function inboxTabsFor({ actor, role }: InboxViewer): readonly InboxTab[] {
  const context = { role };
  return inboxTabs.filter((tab) => {
    if (tab === "requests") return can(actor, "approve", "membership", context);
    if (tab === "reports") return can(actor, "review", "report", context);
    return can(actor, "read", "approval", context);
  });
}

function countTab(tab: InboxTab, actor: Actor, communityId: string): Promise<number> {
  if (tab === "requests") return getManageService().countJoinRequests(actor, communityId);
  if (tab === "approvals") return getApprovalsService().pendingCount(actor, communityId);
  return Promise.all([
    getPostsService().countOpenReports(actor, communityId),
    getReviewsService().countOpenReviewReports(actor, communityId),
  ]).then(([posts, reviews]) => posts + reviews);
}

export const loadInboxCounts = cache(
  async (actor: Actor, role: CommunityRole, communityId: string): Promise<InboxCounts> => {
    const tabs = inboxTabsFor({ actor, role });
    const counts = await Promise.all(
      tabs.map(async (tab): Promise<[InboxTab, number] | null> => {
        try {
          return [tab, await countTab(tab, actor, communityId)];
        } catch (error) {
          logger.warn(
            {
              tab,
              reason: error instanceof Error ? error.name : "unknown",
            },
            "Could not count the Inbox tab",
          );
          return null;
        }
      }),
    );
    return Object.fromEntries(counts.filter((entry) => entry !== null));
  },
);

export function inboxTotal(counts: InboxCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function openInboxTab(
  tabs: readonly InboxTab[],
  counts: InboxCounts,
  requested: unknown,
): InboxTab | null {
  const asked = tabs.find((tab) => tab === requested);
  if (asked) return asked;
  return tabs.find((tab) => (counts[tab] ?? 0) > 0) ?? tabs[0] ?? null;
}
