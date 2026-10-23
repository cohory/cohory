import { signInPath } from "@cohory/auth";
import { ForbiddenError, type Actor } from "@cohory/authz";
import {
  CommunitiesError,
  CommunityNotFoundError,
  getCommunitiesService,
  getManageService,
  PaymentRequiredError,
} from "@cohory/communities";
import { LimitReachedError } from "@cohory/fair-use";
import { getPaymentsService } from "@cohory/payments";
import { RateLimitedError } from "@cohory/rate-limit";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { actorFor } from "../../../../lib/actor";
import {
  joinContinuePath,
  joinFallbackPath,
  joinIntentCookie,
  joinIntentSchema,
  joinIntentSlugSchema,
  matchesJoinIntent,
  planJoinContinuation,
  type JoinContinuation,
  type JoinIntent,
} from "../../../../lib/communities/join-intent";
import { aboutHref } from "../../../../lib/communities/join-state";
import { paymentsActionFailure } from "../../../../lib/payments/errors";
import { rejoinWithPaidAccess } from "../../../../lib/payments/rejoin";
import { redirectUrlSchema } from "../../../../lib/payments/schemas";
import { currentSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

function isExpectedJoinFailure(error: unknown): boolean {
  return (
    error instanceof ForbiddenError ||
    error instanceof CommunitiesError ||
    error instanceof LimitReachedError ||
    error instanceof RateLimitedError
  );
}

function joined(slug: string): string {
  revalidatePath("/");
  revalidatePath(`/c/${slug}`, "layout");
  return `/c/${encodeURIComponent(slug)}`;
}

async function rejoinOrCheckout(actor: Actor, communityId: string, slug: string): Promise<string> {
  return (await rejoinWithPaidAccess(actor, communityId))
    ? joined(slug)
    : joinFallbackPath(slug, "checkout");
}

async function join(actor: Actor, communityId: string, slug: string): Promise<string> {
  try {
    await getCommunitiesService().joinCommunity(actor, communityId);
  } catch (error) {
    if (error instanceof PaymentRequiredError) return rejoinOrCheckout(actor, communityId, slug);
    if (isExpectedJoinFailure(error)) return aboutHref(slug);
    throw error;
  }
  return joined(slug);
}

async function request(actor: Actor, communityId: string, slug: string): Promise<string> {
  try {
    await getManageService().requestToJoin(actor, communityId, { answers: [] });
  } catch (error) {
    if (error instanceof PaymentRequiredError) return rejoinOrCheckout(actor, communityId, slug);
    if (isExpectedJoinFailure(error)) return joinFallbackPath(slug, "request");
    throw error;
  }
  revalidatePath(`/c/${slug}`, "layout");
  return aboutHref(slug);
}

async function checkout(
  actor: Actor,
  communityId: string,
  slug: string,
  interval: "month" | "year",
): Promise<string> {
  if (await rejoinWithPaidAccess(actor, communityId)) return joined(slug);
  try {
    const session = await getPaymentsService().createCheckoutSession(actor, communityId, {
      interval,
    });
    return redirectUrlSchema.parse(session.url);
  } catch (error) {
    if (paymentsActionFailure(error, "member") || isExpectedJoinFailure(error)) {
      return joinFallbackPath(slug, "checkout");
    }
    throw error;
  }
}

async function destination(
  plan: JoinContinuation,
  actor: Actor,
  communityId: string,
  slug: string,
  intent: JoinIntent,
): Promise<string> {
  switch (plan.kind) {
    case "sign_in":
      return signInPath(joinContinuePath(slug, intent));
    case "go":
      return plan.path;
    case "join":
      return join(actor, communityId, slug);
    case "request":
      return request(actor, communityId, slug);
    case "checkout":
      return checkout(actor, communityId, slug, plan.interval);
  }
}

export async function GET(request_: Request, context: RouteContext<"/c/[slug]/join">) {
  const slug = joinIntentSlugSchema.safeParse((await context.params).slug);
  const intent = joinIntentSchema.safeParse(new URL(request_.url).searchParams.get("intent"));
  if (!slug.success || !intent.success) {
    redirect("/");
  }
  const session = await currentSession();
  const jar = await cookies();
  const cookieMatches = matchesJoinIntent(jar.get(joinIntentCookie)?.value, slug.data, intent.data);
  if (!session) {
    redirect(signInPath(joinContinuePath(slug.data, intent.data)));
  }
  jar.delete(joinIntentCookie);
  const actor = actorFor(session);
  const service = getCommunitiesService();
  let community: Awaited<ReturnType<typeof service.getCommunityBySlug>>;
  try {
    community = await service.getCommunityBySlug(actor, slug.data);
  } catch (error) {
    if (error instanceof CommunityNotFoundError) redirect("/");
    throw error;
  }
  const membership = await service.getMembership(actor, community.id);
  const plan = planJoinContinuation({
    slug: community.slug,
    intent: intent.data,
    signedIn: true,
    member: membership?.status === "active",
    cookieMatches,
    questionCount: community.joinQuestions.length,
  });
  redirect(await destination(plan, actor, community.id, community.slug, intent.data));
}
