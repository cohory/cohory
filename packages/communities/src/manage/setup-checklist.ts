import { assertCan, type Actor } from "@cohory/authz";
import type { Community } from "@cohory/db";
import { z } from "zod";

import { inManagedCommunity, parseInput, type Runtime } from "./context";
import type { CommunityPatch } from "./repository";

export const setupStepKeys = [
  "import",
  "branding",
  "about",
  "price",
  "stripe",
  "welcome_post",
  "first_content",
  "preview",
  "share",
  "test_purchase",
] as const;

export type SetupStepKey = (typeof setupStepKeys)[number];

export interface SetupStep {
  readonly key: SetupStepKey;
  readonly done: boolean;
  readonly href: string;
}

export interface SetupChecklist {
  readonly steps: readonly SetupStep[];
  readonly hidden: boolean;
  readonly doneCount: number;
}

export const aboutDescriptionMinLength = 80;
export const shareMemberGoal = 5;

export interface SetupPaymentFacts {
  readonly planSaved: boolean;
  readonly chargesEnabled: boolean;
  readonly livemode: boolean;
  readonly everPaid: boolean;
}

export interface SetupExternalFacts {
  readonly importRan: boolean | null;
  readonly payments: SetupPaymentFacts | null;
}

export interface SetupCounts {
  readonly galleryItems: number;
  readonly pinnedStaffPosts: number;
  readonly publishedCourses: number;
  readonly upcomingEvents: number;
  readonly members: number;
}

export const setupMarks = ["hide", "skip_import", "about_previewed", "invite_link_copied"] as const;

export type SetupMark = (typeof setupMarks)[number];

const setupMarkSchema = z.enum(setupMarks);

const markColumns = {
  hide: "setupChecklistHiddenAt",
  skip_import: "setupImportSkippedAt",
  about_previewed: "aboutPreviewedAt",
  invite_link_copied: "inviteLinkCopiedAt",
} as const satisfies Record<SetupMark, keyof CommunityPatch>;

function stepHrefs(slug: string): Record<SetupStepKey, string> {
  const base = `/c/${encodeURIComponent(slug)}`;
  return {
    import: `${base}/manage/migration`,
    branding: `${base}/manage/appearance`,
    about: `${base}/manage/appearance`,
    price: `${base}/manage/payments`,
    stripe: `${base}/manage/payments?setup=connect`,
    welcome_post: base,
    first_content: `${base}/classroom/new`,
    preview: `${base}/about?preview=1`,
    share: `${base}/manage/people#invite`,
    test_purchase: `${base}/manage/payments`,
  };
}

export function buildSetupChecklist(
  community: Pick<
    Community,
    | "slug"
    | "description"
    | "appearance"
    | "setupChecklistHiddenAt"
    | "setupImportSkippedAt"
    | "aboutPreviewedAt"
    | "inviteLinkCopiedAt"
    | "testCheckoutSucceededAt"
  >,
  counts: SetupCounts,
  external: SetupExternalFacts,
): SetupChecklist {
  const payments = external.payments;
  const done: Partial<Record<SetupStepKey, boolean>> = {
    branding: Boolean(community.appearance.logoKey) && Boolean(community.appearance.coverKey),
    about:
      (community.description?.trim().length ?? 0) > aboutDescriptionMinLength &&
      counts.galleryItems > 0,
    welcome_post: counts.pinnedStaffPosts > 0,
    first_content: counts.publishedCourses > 0 || counts.upcomingEvents > 0,
    preview: community.aboutPreviewedAt !== null,
    share: community.inviteLinkCopiedAt !== null || counts.members >= shareMemberGoal,
  };
  if (external.importRan !== null) {
    done.import = external.importRan || community.setupImportSkippedAt !== null;
  }
  if (payments) {
    done.price = payments.planSaved;
    done.stripe = payments.chargesEnabled;
    done.test_purchase =
      payments.livemode &&
      payments.chargesEnabled &&
      (community.testCheckoutSucceededAt !== null || payments.everPaid);
  }
  const hrefs = stepHrefs(community.slug);
  const steps = setupStepKeys.flatMap((key): SetupStep[] => {
    const state = done[key];
    return state === undefined ? [] : [{ key, done: state, href: hrefs[key] }];
  });
  return {
    steps,
    hidden: community.setupChecklistHiddenAt !== null,
    doneCount: steps.filter((step) => step.done).length,
  };
}

export function setupChecklistOperations(runtime: Runtime) {
  return {
    getSetupChecklist(
      actor: Actor,
      communityId: string,
      external: SetupExternalFacts,
    ): Promise<SetupChecklist> {
      return inManagedCommunity(
        runtime,
        actor,
        communityId,
        async ({ community, context, store }) => {
          assertCan(actor, "read", "settings", context);
          const counts = await store.setupCounts(runtime.now());
          return buildSetupChecklist(community, counts, external);
        },
      );
    },

    markSetupProgress(actor: Actor, communityId: string, mark: SetupMark): Promise<void> {
      const parsed = parseInput(setupMarkSchema, mark);
      return inManagedCommunity(
        runtime,
        actor,
        communityId,
        async ({ community, context, store }) => {
          assertCan(actor, "update", "settings", context);
          const column = markColumns[parsed];
          if (community[column] !== null) {
            return;
          }
          await store.updateCommunity({ [column]: runtime.now() });
        },
      );
    },
  };
}
