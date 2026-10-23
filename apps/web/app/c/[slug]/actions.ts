"use server";

import { requireSession } from "@cohory/auth/next";
import { ForbiddenError, type Actor } from "@cohory/authz";
import {
  CommunitiesError,
  CommunityValidationError,
  getCommunitiesService,
  getManageService,
  InviteOnlyError,
  PaymentRequiredError,
} from "@cohory/communities";
import { LimitReachedError, limitReachedMessage } from "@cohory/fair-use";
import { RateLimitedError } from "@cohory/rate-limit";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { actorFor } from "../../../lib/actor";
import {
  joinContinuePath,
  joinIntentCookie,
  joinIntentCookieValue,
  joinIntentMaxAgeSeconds,
  joinIntentSchema,
  joinIntentSlugSchema,
  signUpForJoinPath,
} from "../../../lib/communities/join-intent";
import { aboutHref } from "../../../lib/communities/join-state";
import { rejoinWithPaidAccess } from "../../../lib/payments/rejoin";
import { currentSession } from "../../../lib/session";
import { rateLimitMessage } from "../../../lib/posts/errors";

export type MembershipActionState = { status: "idle" } | { status: "error"; message: string };

type MembershipChange = (actor: Actor, communityId: string) => Promise<unknown>;

async function changeMembership(
  slug: string,
  change: MembershipChange,
  failure: string,
): Promise<MembershipActionState> {
  const actor = actorFor(await requireSession(`/c/${encodeURIComponent(slug)}`));
  let communitySlug: string;
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
    await change(actor, community.id);
    communitySlug = community.slug;
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      redirect(`/c/${encodeURIComponent(slug)}/membership`);
    }
    if (error instanceof LimitReachedError) {
      return { status: "error", message: limitReachedMessage(error) };
    }
    if (error instanceof ForbiddenError || error instanceof CommunitiesError) {
      return { status: "error", message: failure };
    }
    throw error;
  }
  revalidatePath("/");
  revalidatePath(`/c/${communitySlug}`, "layout");
  redirect(`/c/${communitySlug}`);
}

async function joinOrRejoin(actor: Actor, communityId: string): Promise<void> {
  try {
    await getCommunitiesService().joinCommunity(actor, communityId);
  } catch (error) {
    if (error instanceof PaymentRequiredError && (await rejoinWithPaidAccess(actor, communityId))) {
      return;
    }
    throw error;
  }
}

export async function joinCommunityAction(slug: string): Promise<MembershipActionState> {
  return changeMembership(
    slug,
    joinOrRejoin,
    "We couldn't add you to this community. Try again later.",
  );
}

export async function leaveCommunityAction(slug: string): Promise<MembershipActionState> {
  const service = getCommunitiesService();
  return changeMembership(
    slug,
    (actor, id) => service.leaveCommunity(actor, id),
    "We couldn't remove you from this community. Try again later.",
  );
}

const answerFields = ["answer-0", "answer-1", "answer-2"] as const;

export async function requestToJoinAction(
  slug: string,
  _previous: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const session = await requireSession(aboutHref(slug));
  const actor = actorFor(session);
  const answers = answerFields.flatMap((field) => {
    const value = formData.get(field);
    return typeof value === "string" ? [value] : [];
  });
  let communitySlug: string;
  let communityId: string | null = null;
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
    communityId = community.id;
    await getManageService().requestToJoin(actor, community.id, { answers });
    communitySlug = community.slug;
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      if (communityId && (await rejoinWithPaidAccess(actor, communityId))) {
        revalidatePath("/");
        revalidatePath(`/c/${slug}`, "layout");
        redirect(`/c/${encodeURIComponent(slug)}`);
      }
      redirect(`/c/${encodeURIComponent(slug)}/membership`);
    }
    if (error instanceof RateLimitedError) {
      return { status: "error", message: rateLimitMessage(error) };
    }
    if (error instanceof LimitReachedError) {
      return { status: "error", message: limitReachedMessage(error) };
    }
    if (error instanceof CommunityValidationError) {
      return {
        status: "error",
        message: error.issues[0]?.message ?? "Check your answers and try again.",
      };
    }
    if (error instanceof InviteOnlyError) {
      return { status: "error", message: "This community is invite only." };
    }
    if (error instanceof ForbiddenError || error instanceof CommunitiesError) {
      return { status: "error", message: "We couldn't send your request. Try again later." };
    }
    throw error;
  }
  revalidatePath(`/c/${communitySlug}`, "layout");
  redirect(aboutHref(communitySlug));
}

export async function startJoinIntentAction(slug: unknown, intent: unknown): Promise<void> {
  const parsedSlug = joinIntentSlugSchema.safeParse(slug);
  const parsedIntent = joinIntentSchema.safeParse(intent);
  if (!parsedSlug.success || !parsedIntent.success) {
    redirect("/");
  }
  const jar = await cookies();
  jar.set(joinIntentCookie, joinIntentCookieValue(parsedSlug.data, parsedIntent.data), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: joinIntentMaxAgeSeconds,
  });
  if (await currentSession()) {
    redirect(joinContinuePath(parsedSlug.data, parsedIntent.data));
  }
  redirect(signUpForJoinPath(parsedSlug.data, parsedIntent.data));
}
