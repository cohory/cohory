"use server";

import { getCommunitiesService, getManageService } from "@cohory/communities";
import { getReviewsService, reviewHiddenReasons, reviewReportReasons } from "@cohory/reviews";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFor } from "../actor";
import { failure, type ActionResult } from "../posts/errors";
import { currentSession } from "../session";
import { reviewsActionFailure } from "./errors";
import { toReviewPageRows, type ReviewPageRows } from "./views";

const slugSchema = z.string().min(1).max(64);
const idSchema = z.uuid();

async function context(slug: string) {
  const session = await currentSession();
  const actor = actorFor(session);
  const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
  return { actor, communityId: community.id, slug: community.slug };
}

async function run<T>(slug: unknown, fn: (ctx: Awaited<ReturnType<typeof context>>) => Promise<T>) {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return failure("Refresh the page and try again.");
  }
  try {
    const ctx = await context(parsedSlug.data);
    const data = await fn(ctx);
    revalidatePath(`/c/${ctx.slug}/about`);
    return { ok: true as const, data };
  } catch (error) {
    const result = reviewsActionFailure(error);
    if (result) return result;
    throw error;
  }
}

const saveSchema = z.object({
  slug: slugSchema,
  reviewId: idSchema.optional(),
  rating: z.number(),
  body: z.string(),
});

export async function saveReviewAction(
  raw: z.input<typeof saveSchema>,
): Promise<ActionResult<null>> {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  const { slug, reviewId, rating, body } = parsed.data;
  return run(slug, async ({ actor, communityId }) => {
    const service = getReviewsService();
    if (reviewId) {
      await service.updateReview(actor, communityId, reviewId, { rating, body });
    } else {
      await service.createReview(actor, communityId, { rating, body });
    }
    return null;
  });
}

const targetSchema = z.object({ slug: slugSchema, reviewId: idSchema });

export async function deleteReviewAction(
  raw: z.input<typeof targetSchema>,
): Promise<ActionResult<null>> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  return run(parsed.data.slug, async ({ actor, communityId }) => {
    await getReviewsService().deleteReview(actor, communityId, parsed.data.reviewId);
    return null;
  });
}

const replySchema = targetSchema.extend({ body: z.string(), edit: z.boolean() });

export async function saveReplyAction(
  raw: z.input<typeof replySchema>,
): Promise<ActionResult<null>> {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  const { slug, reviewId, body, edit } = parsed.data;
  return run(slug, async ({ actor, communityId }) => {
    const service = getReviewsService();
    if (edit) {
      await service.updateReply(actor, communityId, reviewId, { body });
    } else {
      await service.replyToReview(actor, communityId, reviewId, { body });
    }
    return null;
  });
}

export async function deleteReplyAction(
  raw: z.input<typeof targetSchema>,
): Promise<ActionResult<null>> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  return run(parsed.data.slug, async ({ actor, communityId }) => {
    await getReviewsService().deleteReply(actor, communityId, parsed.data.reviewId);
    return null;
  });
}

const reportSchema = targetSchema.extend({
  reason: z.enum(reviewReportReasons),
  note: z.string().optional(),
});

export async function reportReviewAction(
  raw: z.input<typeof reportSchema>,
): Promise<ActionResult<null>> {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  const { slug, reviewId, reason, note } = parsed.data;
  return run(slug, async ({ actor, communityId }) => {
    await getReviewsService().reportReview(actor, communityId, reviewId, {
      reason,
      ...(note ? { note } : {}),
    });
    return null;
  });
}

const hideSchema = targetSchema.extend({ reason: z.enum(reviewHiddenReasons) });

export async function hideReviewAction(
  raw: z.input<typeof hideSchema>,
): Promise<ActionResult<null>> {
  const parsed = hideSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  const { slug, reviewId, reason } = parsed.data;
  return run(slug, async ({ actor, communityId }) => {
    await getReviewsService().hideReview(actor, communityId, reviewId, { reason });
    revalidatePath(`/c/${slug}/manage/inbox`);
    return null;
  });
}

export async function dismissReviewReportsAction(
  raw: z.input<typeof targetSchema>,
): Promise<ActionResult<null>> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  return run(parsed.data.slug, async ({ actor, communityId }) => {
    await getReviewsService().dismissReviewReports(actor, communityId, parsed.data.reviewId);
    revalidatePath(`/c/${parsed.data.slug}/manage/inbox`);
    return null;
  });
}

const pageSchema = z.object({
  slug: slugSchema,
  rating: z.number().int().min(1).max(5).nullable(),
  cursor: z.string().max(512).nullable(),
});

export async function loadReviewsAction(
  raw: z.input<typeof pageSchema>,
): Promise<ActionResult<ReviewPageRows>> {
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  const { slug, rating, cursor } = parsed.data;
  try {
    const { actor, communityId } = await context(slug);
    const result = await getReviewsService().listReviews(actor, communityId, {
      ...(cursor ? { cursor } : {}),
      ...(rating ? { rating } : {}),
    });
    return {
      ok: true,
      data: toReviewPageRows(result, actor.kind === "user" ? actor.userId : null),
    };
  } catch (error) {
    const result = reviewsActionFailure(error);
    if (result) return result;
    throw error;
  }
}

const settingSchema = z.object({ slug: slugSchema, enabled: z.boolean() });

export async function saveReviewsSettingAction(
  raw: z.input<typeof settingSchema>,
): Promise<ActionResult<null>> {
  const parsed = settingSchema.safeParse(raw);
  if (!parsed.success) return failure("Refresh the page and try again.");
  return run(parsed.data.slug, async ({ actor, communityId }) => {
    await getManageService().setReviewsEnabled(actor, communityId, parsed.data.enabled);
    revalidatePath(`/c/${parsed.data.slug}/manage/settings`);
    return null;
  });
}
