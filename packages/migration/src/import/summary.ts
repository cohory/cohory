import type { MembershipPlanRecord } from "../format/records";
import type { SlugRename } from "./slugs";

export type SkippedItem = {
  readonly entity: string;
  readonly sourceId: string;
  readonly reason: string;
  readonly values?: Readonly<Record<string, string>>;
};

export type PendingSubscriptionLink = {
  readonly userId: string;
  readonly email: string;
  readonly externalSubscriptionId: string;
  readonly externalCustomerId: string;
  readonly planId: string | null;
  readonly providerStatus: string;
  readonly accessState: "none" | "granted" | "grace" | "revoked";
  readonly interval: "month" | "year" | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly compId: string | null;
};

export type ImportSummary = {
  readonly imported: Readonly<Record<string, number>>;
  readonly skipped: readonly SkippedItem[];
  readonly skippedTotal: number;
  readonly users: {
    readonly created: number;
    readonly linked: number;
    readonly invited?: number;
  };
  readonly ownerImportedAs: "owner" | "admin" | "none";
  readonly renamedInviteLinks: number;
  readonly renamedSlugs: readonly SlugRename[];
  readonly plans: readonly MembershipPlanRecord[];
  readonly subscriptionLinks: readonly PendingSubscriptionLink[];
  readonly uploads: { readonly restored: number; readonly missing: readonly string[] };
  readonly emailsSent: number;
  readonly emailsNotSent?: number;
  readonly emailsOverLimit?: number;
  readonly emailsByDay?: Readonly<Record<string, number>>;
  readonly warnings?: readonly string[];
};

export const maxSkippedListed = 200;

export class SkipLog {
  private readonly items: SkippedItem[] = [];
  private total = 0;

  add(entity: string, sourceId: string, reason: string): void {
    this.total += 1;
    if (this.items.length < maxSkippedListed) {
      this.items.push({ entity, sourceId, reason });
    }
  }

  get listed(): readonly SkippedItem[] {
    return this.items;
  }

  get count(): number {
    return this.total;
  }
}
