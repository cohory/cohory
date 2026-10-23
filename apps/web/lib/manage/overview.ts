import type { Actor, CommunityRole } from "@cohory/authz";
import {
  getManageService,
  shareMemberGoal,
  type SetupChecklist,
  type SetupExternalFacts,
  type SetupStepKey,
} from "@cohory/communities";
import { getMigrationService, type MigrationJobView } from "@cohory/migration";
import { getPaymentsService, type RevenueMetrics } from "@cohory/payments";
import { formatCount } from "@cohory/ui/lib/format-number";
import { cache } from "react";

import type { ManageSection } from "./sections";

export interface OverviewViewer {
  readonly actor: Actor;
  readonly role: CommunityRole;
  readonly communityId: string;
  readonly slug: string;
}

export interface SetupStepCopy {
  readonly title: string;
  readonly hint: string;
}

export const setupStepCopy: Readonly<Record<SetupStepKey, SetupStepCopy>> = {
  import: {
    title: "Moving from Skool or Circle? Import first",
    hint: "Imports only work while your community is empty.",
  },
  branding: { title: "Add your logo and cover", hint: "Both appear on your About page." },
  about: {
    title: "Write your About page",
    hint: "A short description of more than 80 characters and one gallery item.",
  },
  price: { title: "Set your price", hint: "Choose what members pay each month or year." },
  stripe: {
    title: "Connect Stripe and finish verification",
    hint: "Stripe checks your identity before you can take payments.",
  },
  welcome_post: {
    title: "Post a welcome and pin it",
    hint: "New members see pinned posts first.",
  },
  first_content: {
    title: "Create your first course or schedule your first call",
    hint: "Give new members something to start with.",
  },
  preview: {
    title: "Preview your About page as a visitor",
    hint: "See what people see before they join.",
  },
  share: {
    title: `Share your link and invite your first ${shareMemberGoal} members`,
    hint: "Copy your community link and send it to people you know.",
  },
  test_purchase: {
    title: "Test a purchase in test mode, then go live",
    hint: "Buy a membership yourself to check the flow, then switch Stripe to live.",
  },
};

export interface ImportState {
  readonly ran: boolean;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface SetupChecklistView extends SetupChecklist {
  readonly importState: ImportState | null;
}

export function importRan(jobs: readonly Pick<MigrationJobView, "kind" | "status">[]): boolean {
  return jobs.some((job) => job.kind !== "export" && job.status === "succeeded");
}

const loadImportAvailability = cache((actor: Actor, communityId: string) =>
  getMigrationService().importAvailability(actor, communityId),
);

async function loadImportState(actor: Actor, communityId: string): Promise<ImportState> {
  const [jobs, availability] = await Promise.all([
    getMigrationService().listJobs(actor, communityId),
    loadImportAvailability(actor, communityId),
  ]);
  return { ran: importRan(jobs), available: availability.available, reason: availability.reason };
}

export const migrationEmptyHint = "Imports only work while the community is empty.";

export async function manageNavHints(viewer: {
  readonly actor: Actor;
  readonly role: CommunityRole;
  readonly communityId: string;
  readonly sections: readonly ManageSection[];
}): Promise<Partial<Record<ManageSection, string>>> {
  if (viewer.role !== "owner" || !viewer.sections.includes("migration")) {
    return {};
  }
  const availability = await loadImportAvailability(viewer.actor, viewer.communityId);
  return availability.available ? { migration: migrationEmptyHint } : {};
}

export const loadRevenueMetrics = cache(
  (actor: Actor, communityId: string): Promise<RevenueMetrics> =>
    getPaymentsService().getRevenueMetrics(actor, communityId),
);

export const loadPaymentsOverview = cache((actor: Actor, communityId: string) =>
  getPaymentsService().getPaymentsOverview(actor, communityId),
);

export async function loadSetupChecklist(viewer: OverviewViewer): Promise<SetupChecklistView> {
  const { actor, communityId } = viewer;
  const [overview, plan, metrics, importState] = await Promise.all([
    loadPaymentsOverview(actor, communityId),
    getPaymentsService().getPlan(actor, communityId),
    loadRevenueMetrics(actor, communityId),
    viewer.role === "owner" ? loadImportState(actor, communityId) : Promise.resolve(null),
  ]);
  const connection = overview.connection;
  const external: SetupExternalFacts = {
    importRan: importState?.ran ?? null,
    payments:
      connection || plan
        ? {
            planSaved: plan !== null,
            chargesEnabled: connection?.status === "active" && connection.chargesEnabled,
            livemode: connection?.livemode ?? false,
            everPaid: metrics.everPaid,
          }
        : null,
  };
  const checklist = await getManageService().getSetupChecklist(actor, communityId, external);
  return { ...checklist, importState };
}

export function nextStep(checklist: SetupChecklist): SetupChecklist["steps"][number] | null {
  return checklist.steps.find((step) => !step.done) ?? null;
}

export interface NeedsYouCounts {
  readonly joinRequests: number;
  readonly reports: number;
  readonly failedPayments: number;
  readonly agentRequests: number;
}

export interface NeedsYouItem {
  readonly key: keyof NeedsYouCounts;
  readonly label: string;
  readonly href: string;
}

function counted(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function needsYouItems(counts: NeedsYouCounts, slug: string): NeedsYouItem[] {
  const base = `/c/${encodeURIComponent(slug)}/manage`;
  const items: NeedsYouItem[] = [
    {
      key: "joinRequests",
      label: counted(counts.joinRequests, "join request", "join requests"),
      href: `${base}/inbox?tab=requests`,
    },
    {
      key: "reports",
      label: counted(counts.reports, "report", "reports"),
      href: `${base}/inbox?tab=reports`,
    },
    {
      key: "failedPayments",
      label: counted(counts.failedPayments, "payment failed", "payments failed"),
      href: `${base}/payments`,
    },
    {
      key: "agentRequests",
      label: counted(counts.agentRequests, "agent request", "agent requests"),
      href: `${base}/inbox?tab=approvals`,
    },
  ];
  return items.filter((item) => counts[item.key] > 0);
}

export type TrendDirection = "up" | "down" | "flat";

export interface TrendView {
  readonly direction: TrendDirection;
  readonly text: string;
}

export function trendOf(
  current: number,
  previous: number,
  period: string,
  format: (value: number) => string = formatCount,
): TrendView {
  if (current === previous) {
    return { direction: "flat", text: `Same as ${period}` };
  }
  const direction = current > previous ? "up" : "down";
  const change = format(Math.abs(current - previous));
  return {
    direction,
    text: `${direction === "up" ? "Up" : "Down"} ${change} from ${period}`,
  };
}
