import { assertCan, can, type Actor } from "@cohory/authz";
import { isUniqueViolation } from "@cohory/db";

import { SlugChangeTooSoonError, SlugTakenError } from "../errors";
import { inManagedCommunity, type Runtime } from "./context";
import {
  nextSlugChangeAt,
  parseNewSlug,
  slugChangeAllowed,
  type ChangeSlugInput,
} from "./slug-rules";

export interface SlugStatusView {
  readonly slug: string;
  readonly canChange: boolean;
  readonly changedAt: Date | null;
  readonly nextChangeAt: Date | null;
}

const slugConstraint = "communities_slug_unique";

export function slugOperations(runtime: Runtime) {
  function statusOf(slug: string, changedAt: Date | null, allowedByRole: boolean): SlugStatusView {
    const now = runtime.now();
    const next = nextSlugChangeAt(changedAt);
    return {
      slug,
      canChange: allowedByRole && slugChangeAllowed(changedAt, now),
      changedAt,
      nextChangeAt: next && next.getTime() > now.getTime() ? next : null,
    };
  }

  return {
    getSlugStatus(actor: Actor, communityId: string): Promise<SlugStatusView> {
      return inManagedCommunity(runtime, actor, communityId, async ({ community, context }) => {
        assertCan(actor, "read", "settings", context);
        return statusOf(
          community.slug,
          community.slugChangedAt,
          can(actor, "change_slug", "community", context),
        );
      });
    },

    async changeSlug(
      actor: Actor,
      communityId: string,
      input: ChangeSlugInput,
    ): Promise<SlugStatusView> {
      try {
        return await inManagedCommunity(runtime, actor, communityId, async (managed) => {
          assertCan(actor, "change_slug", "community", managed.context);
          const slug = parseNewSlug(input.slug);
          const { community } = managed;
          if (slug === community.slug) {
            return statusOf(community.slug, community.slugChangedAt, true);
          }
          const now = runtime.now();
          if (!slugChangeAllowed(community.slugChangedAt, now)) {
            const next = nextSlugChangeAt(community.slugChangedAt);
            throw new SlugChangeTooSoonError(next ?? now);
          }
          const updated = await managed.store.updateCommunity({ slug, slugChangedAt: now });
          await managed.store.appendAudit({
            actorId: managed.user.userId,
            action: "community.slug_changed",
            target: community.id,
            metadata: { from: community.slug, to: updated.slug },
          });
          return statusOf(updated.slug, updated.slugChangedAt, true);
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error, slugConstraint)) {
          throw new SlugTakenError(input.slug.trim());
        }
        throw error;
      }
    },
  };
}
