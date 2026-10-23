"use server";

import { assertCan, ForbiddenError } from "@cohory/authz";
import {
  accentMessages,
  deriveAccentTokens,
  getManageService,
  PaymentRequiredError,
  type AppearanceNotice,
  type BulkResult,
  type AppearanceView,
} from "@cohory/communities";
import { LimitReachedError, limitReachedMessage } from "@cohory/fair-use";
import { getPaymentsService, type MemberBilling } from "@cohory/payments";
import { getRateLimiter, RateLimitedError } from "@cohory/rate-limit";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { actorFor } from "../actor";
import { clearInviteIntent } from "../communities/join-intent";
import { recordExitQuietly } from "../feedback/service";
import { membershipHref } from "../payments/views";
import { resolveCommunity, type CommunityContext } from "../posts/context";
import { failure, rateLimitMessage, type ActionResult } from "../posts/errors";
import { currentSession } from "../session";
import { manageActionFailure } from "./errors";
import { loadMemberDetail, type MemberDetail } from "./member-detail";
import { inviteFailureMessage, inviteMessages, type JoinInviteState } from "./invite";
import {
  brandingKindSchema,
  bulkBillingSchema,
  bulkPersonActionSchema,
  changeRoleSchema,
  createInviteSchema,
  deleteCommunitySchema,
  gamificationSchema,
  generalSettingsSchema,
  listPeopleSchema,
  memberActionSchema,
  namesMatch,
  personActionSchema,
  previewAccentSchema,
  retryDeleteSchema,
  revokeInviteSchema,
  saveAppearanceSchema,
  archiveSchema,
  slugInputSchema,
  type ArchiveActionInput,
  type BulkPersonActionInput,
  transferSchema,
  type ChangeRoleInput,
  type CreateInviteActionInput,
  type DeleteCommunityActionInput,
  type GamificationInput,
  type GeneralSettingsInput,
  type ListPeopleInput,
  type PersonActionInput,
  type RetryDeleteActionInput,
  type SaveAppearanceInput,
  type TransferInput,
} from "./schemas";
import {
  appUrl,
  toInviteRow,
  toPersonRow,
  type InviteRow,
  type ModeTokens,
  type PersonRow,
} from "./views";

class ActionInputError extends Error {}

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ActionInputError) return failure(error.message);
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}

function managePath(context: CommunityContext): string {
  return `/c/${context.slug}/manage`;
}

function viewerOf(context: CommunityContext) {
  const { actor, role } = context.access;
  if (actor.kind !== "user" || role === null) {
    throw new ForbiddenError("manage", "membership");
  }
  return { actor, role };
}

export interface AccentPreview {
  readonly light: ModeTokens;
  readonly dark: ModeTokens;
  readonly ratios: {
    readonly light: Record<string, number>;
    readonly dark: Record<string, number>;
  };
  readonly notices: readonly AppearanceNotice[];
}

export async function previewAccentAction(raw: {
  slug: string;
  accent: string;
}): Promise<ActionResult<AccentPreview>> {
  return guard(async () => {
    const { slug } = slugInputSchema.parse(raw);
    const { accent } = previewAccentSchema.parse(raw);
    const context = await resolveCommunity(slug);
    assertCan(context.access.actor, "update", "appearance", {
      role: context.access.role,
      communityPrivacy: context.access.privacy,
    });
    const derived = deriveAccentTokens(accent);
    const notices: AppearanceNotice[] = [];
    if (derived.fallbackUsed) notices.push({ code: "fallback", message: accentMessages.fallback });
    if (derived.warning) notices.push({ code: "red_hue", message: accentMessages.red_hue });
    return {
      light: { ...derived.light },
      dark: { ...derived.dark },
      ratios: { light: { ...derived.ratios.light }, dark: { ...derived.ratios.dark } },
      notices,
    };
  });
}

export interface AppearanceResult {
  readonly accent: string | null;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly notices: readonly AppearanceNotice[];
}

function appearanceResult(view: AppearanceView): AppearanceResult {
  return {
    accent: view.accent,
    logoUrl: view.logoUrl,
    coverUrl: view.coverUrl,
    notices: [...view.notices],
  };
}

export async function saveAppearanceAction(
  raw: SaveAppearanceInput,
): Promise<ActionResult<AppearanceResult>> {
  return guard(async () => {
    const input = saveAppearanceSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const view = await getManageService().updateAppearance(
      context.access.actor,
      context.communityId,
      { accent: input.accent, font: input.font, cardStyle: input.cardStyle, theme: input.theme },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return appearanceResult(view);
  });
}

export async function uploadBrandingAction(
  slug: string,
  kind: "logo" | "cover",
  formData: FormData,
): Promise<ActionResult<AppearanceResult>> {
  return guard(async () => {
    const input = slugInputSchema.parse({ slug });
    const parsedKind = brandingKindSchema.parse(kind);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ActionInputError("Choose an image to upload.");
    }
    const context = await resolveCommunity(input.slug);
    const view = await getManageService().uploadBranding(
      context.access.actor,
      context.communityId,
      parsedKind,
      { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return appearanceResult(view);
  });
}

export async function removeBrandingAction(
  slug: string,
  kind: "logo" | "cover",
): Promise<ActionResult<AppearanceResult>> {
  return guard(async () => {
    const input = slugInputSchema.parse({ slug });
    const parsedKind = brandingKindSchema.parse(kind);
    const context = await resolveCommunity(input.slug);
    const view = await getManageService().updateAppearance(
      context.access.actor,
      context.communityId,
      parsedKind === "logo" ? { logo: null } : { cover: null },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return appearanceResult(view);
  });
}

export async function saveGeneralAction(raw: GeneralSettingsInput): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = generalSettingsSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    await getManageService().updateGeneral(context.access.actor, context.communityId, {
      name: input.name,
      privacy: input.privacy,
    });
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function saveGamificationAction(raw: GamificationInput): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = gamificationSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    await getManageService().updateSettings(context.access.actor, context.communityId, {
      gamificationEnabled: input.enabled,
      levelNames: input.levelNames,
      pointsForLessons: input.pointsForLessons,
      pointsForEvents: input.pointsForEvents,
    });
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function listPeopleAction(
  raw: ListPeopleInput,
): Promise<ActionResult<{ rows: PersonRow[]; nextCursor: string | null }>> {
  return guard(async () => {
    const input = listPeopleSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const viewer = viewerOf(context);
    const page = await getManageService().listMembersForManage(viewer.actor, context.communityId, {
      query: input.query || undefined,
      role: input.role,
      ...(input.inactiveDays === undefined
        ? { status: input.status }
        : { inactiveDays: input.inactiveDays }),
      neverSignedIn: input.neverSignedIn,
      access: input.access,
      cursor: input.cursor,
    });
    return {
      rows: page.data.map((member) => toPersonRow(viewer, member)),
      nextCursor: page.nextCursor,
    };
  });
}

export async function changeRoleAction(raw: ChangeRoleInput): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = changeRoleSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    await getManageService().changeRole(
      context.access.actor,
      context.communityId,
      input.userId,
      input.role,
    );
    revalidatePath(`${managePath(context)}/people`);
    return null;
  });
}

export async function personAction(raw: PersonActionInput): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = personActionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const service = getManageService();
    const run = {
      remove: service.removeMember,
      ban: service.banMember,
      unban: service.unbanMember,
    }[input.action];
    await run(context.access.actor, context.communityId, input.userId);
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function memberDetailAction(raw: {
  slug: string;
  userId: string;
}): Promise<ActionResult<MemberDetail | null>> {
  return guard(async () => {
    const input = memberActionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    return loadMemberDetail(viewerOf(context), context.communityId, input.userId);
  });
}

export async function bulkPersonAction(
  raw: BulkPersonActionInput,
): Promise<ActionResult<BulkResult>> {
  return guard(async () => {
    const input = bulkPersonActionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const result = await getManageService().applyMemberAction(
      context.access.actor,
      context.communityId,
      { userIds: input.userIds, action: input.action },
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return result;
  });
}

export async function bulkBillingAction(raw: {
  slug: string;
  userIds: string[];
}): Promise<ActionResult<{ userId: string; billing: MemberBilling }[]>> {
  return guard(async () => {
    const input = bulkBillingSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const payments = getPaymentsService();
    const billings: { userId: string; billing: MemberBilling }[] = [];
    for (const userId of input.userIds) {
      billings.push({
        userId,
        billing: await payments.getMemberBilling(context.access.actor, context.communityId, userId),
      });
    }
    return billings;
  });
}

export async function memberBillingAction(raw: {
  slug: string;
  userId: string;
}): Promise<ActionResult<MemberBilling>> {
  return guard(async () => {
    const input = memberActionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    return getPaymentsService().getMemberBilling(
      context.access.actor,
      context.communityId,
      input.userId,
    );
  });
}

const dayMs = 24 * 60 * 60 * 1000;

export async function createInviteAction(
  raw: CreateInviteActionInput,
): Promise<ActionResult<InviteRow>> {
  return guard(async () => {
    const input = createInviteSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    if (context.access.actor.kind === "user") {
      getRateLimiter().consume("inviteCreate", context.access.actor.userId);
    }
    const invite = await getManageService().createInviteLink(
      context.access.actor,
      context.communityId,
      {
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * dayMs) : null,
        maxUses: input.maxUses,
        requiresApproval: input.requiresApproval,
        label: input.label || null,
      },
    );
    revalidatePath(`${managePath(context)}/people`);
    return toInviteRow(appUrl(), invite);
  });
}

export async function revokeInviteAction(raw: {
  slug: string;
  inviteId: string;
}): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = revokeInviteSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    await getManageService().revokeInviteLink(
      context.access.actor,
      context.communityId,
      input.inviteId,
    );
    revalidatePath(`${managePath(context)}/people`);
    return null;
  });
}

const nameMismatch = "Type the community name exactly to confirm.";

async function communityName(context: CommunityContext): Promise<string> {
  const settings = await getManageService().getSettings(context.access.actor, context.communityId);
  return settings.name;
}

export async function transferOwnershipAction(raw: TransferInput): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = transferSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    if (!namesMatch(await communityName(context), input.confirmName)) {
      throw new ActionInputError(nameMismatch);
    }
    await getManageService().transferOwnership(
      context.access.actor,
      context.communityId,
      input.userId,
    );
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export async function setArchivedAction(raw: ArchiveActionInput): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = archiveSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const service = getManageService();
    if (input.archived) {
      await service.archiveCommunity(context.access.actor, context.communityId, {
        ...(input.paidMembers ? { paidMembers: input.paidMembers } : {}),
        ...(input.includeLinked === undefined ? {} : { includeLinked: input.includeLinked }),
      });
      await recordExitQuietly(
        context.access.actor,
        { communityId: context.communityId, action: "archive_community" },
        input.exit,
      );
    } else {
      await service.unarchiveCommunity(context.access.actor, context.communityId);
    }
    revalidatePath(`/c/${context.slug}`, "layout");
    return null;
  });
}

export type DeleteActionOutcome = "deleted" | "deleting";

async function deleteAndSettle(
  context: CommunityContext,
  input: { includeLinked: boolean; confirmedManualCancellation: boolean },
): Promise<DeleteActionOutcome> {
  const outcome = await getManageService().deleteCommunity(
    context.access.actor,
    context.communityId,
    input,
  );
  if (outcome.kind === "deleting") {
    revalidatePath(`/c/${context.slug}`, "layout");
  }
  return outcome.kind;
}

function leaveIfDeleted(result: ActionResult<DeleteActionOutcome>): void {
  if (result.ok && result.data === "deleted") {
    revalidatePath("/");
    redirect("/");
  }
}

export async function deleteCommunityAction(
  raw: DeleteCommunityActionInput,
): Promise<ActionResult<DeleteActionOutcome>> {
  const result = await guard(async () => {
    const input = deleteCommunitySchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    if (!namesMatch(await communityName(context), input.confirmName)) {
      throw new ActionInputError(nameMismatch);
    }
    await recordExitQuietly(
      context.access.actor,
      { communityId: context.communityId, action: "delete_community" },
      input.exit,
    );
    return deleteAndSettle(context, {
      includeLinked: input.includeLinked,
      confirmedManualCancellation: input.confirmedManualCancellation,
    });
  });
  leaveIfDeleted(result);
  return result;
}

export async function retryDeleteCommunityAction(
  raw: RetryDeleteActionInput,
): Promise<ActionResult<DeleteActionOutcome>> {
  const result = await guard(async () => {
    const input = retryDeleteSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    return deleteAndSettle(context, {
      includeLinked: input.includeLinked,
      confirmedManualCancellation: false,
    });
  });
  leaveIfDeleted(result);
  return result;
}

export async function redeemInviteAction(token: string): Promise<JoinInviteState> {
  const session = await currentSession();
  if (!session) {
    return { status: "error", message: inviteMessages.signedOut };
  }
  let slug: string;
  let requested = false;
  try {
    getRateLimiter().consume("inviteRedeem", session.user.id);
    const result = await getManageService().redeemInvite(actorFor(session), token);
    slug = result.community.slug;
    requested = result.request !== null;
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      const preview = await getManageService().previewInvite(token);
      if (preview) redirect(membershipHref(preview.community.slug));
    }
    if (error instanceof RateLimitedError) {
      return { status: "error", message: rateLimitMessage(error) };
    }
    if (error instanceof LimitReachedError) {
      return { status: "error", message: limitReachedMessage(error) };
    }
    const message = inviteFailureMessage(error);
    if (message) return { status: "error", message };
    throw error;
  }
  clearInviteIntent(await cookies(), token);
  revalidatePath("/");
  revalidatePath(`/c/${slug}`, "layout");
  redirect(requested ? `/c/${slug}/about` : `/c/${slug}`);
}
