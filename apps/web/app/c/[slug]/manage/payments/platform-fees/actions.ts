"use server";

import { getCommunitiesService } from "@cohory/communities";
import { getPlatformBillingService } from "@cohory/payments/billing";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { actorFor } from "../../../../../../lib/actor";
import { paymentsActionFailure } from "../../../../../../lib/payments/errors";
import { requireCurrentSession } from "../../../../../../lib/session";
import { failure } from "../../../../../../lib/posts/errors";

type Result = { ok: true } | { ok: false; message: string };

const slugSchema = z.object({ slug: z.string().min(1).max(64) });
const emailSchema = slugSchema.extend({ email: z.string().max(254) });
const stripeUrlSchema = z.url({ protocol: /^https$/ });

function platformFeesPath(slug: string): string {
  return `/c/${slug}/manage/payments/platform-fees`;
}

async function target(slug: string) {
  const actor = actorFor(await requireCurrentSession(platformFeesPath(slug)));
  const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
  return { actor, communityId: community.id, slug: community.slug };
}

export async function saveBillingEmailAction(input: unknown): Promise<Result> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) {
    return failure("Enter an email address.");
  }
  try {
    const { actor, communityId, slug } = await target(parsed.data.slug);
    await getPlatformBillingService().updateBillingEmail(actor, communityId, {
      email: parsed.data.email,
    });
    revalidatePath(platformFeesPath(slug));
    return { ok: true };
  } catch (error) {
    const result = paymentsActionFailure(error, "creator");
    if (result) {
      return result.message.startsWith("Invalid")
        ? failure("Enter a valid email address.")
        : result;
    }
    throw error;
  }
}

export async function startCardSetupAction(input: unknown): Promise<Result> {
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) {
    return failure("Something went wrong. Refresh the page and try again.");
  }
  let url: string;
  try {
    const { actor, communityId } = await target(parsed.data.slug);
    url = (await getPlatformBillingService().startPaymentMethodSetup(actor, communityId)).url;
  } catch (error) {
    const result = paymentsActionFailure(error, "creator");
    if (result) return result;
    throw error;
  }
  redirect(stripeUrlSchema.parse(url));
}
