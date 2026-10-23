import { getManageService, type JoinStatusView } from "@cohory/communities";
import type { JoinMode, JoinQuestion } from "@cohory/db/schema";
import { getPaymentsService, PaymentsError } from "@cohory/payments";

import type { PaidJoinView } from "../payments/gating";
import type { JoinIntent } from "./join-intent";
import type { CommunityPage } from "./load";

export type JoinState =
  | { readonly kind: "member" }
  | { readonly kind: "paid"; readonly paidJoin: PaidJoinView }
  | { readonly kind: "rejoin" }
  | {
      readonly kind: "sign_up";
      readonly intent: JoinIntent;
      readonly label: string;
      readonly yearlyLabel?: string | null;
    }
  | { readonly kind: "join" }
  | { readonly kind: "request"; readonly questions: readonly JoinQuestion[] }
  | { readonly kind: "pending" }
  | {
      readonly kind: "declined";
      readonly note: string | null;
      readonly questions: readonly JoinQuestion[];
    }
  | { readonly kind: "invite_only" }
  | { readonly kind: "unavailable" };

export interface JoinStateInput {
  readonly signedIn: boolean;
  readonly slug: string;
  readonly joinMode: JoinMode;
  readonly questions: readonly JoinQuestion[];
  readonly archived: boolean;
  readonly paidJoin: PaidJoinView | null;
  readonly canRejoin: boolean;
  readonly status: JoinStatusView | null;
}

export function aboutHref(slug: string): string {
  return `/c/${encodeURIComponent(slug)}/about`;
}

export function resolveJoinState(input: JoinStateInput): JoinState {
  const membership = input.status?.membershipStatus ?? null;
  const request = input.status?.request ?? null;
  if (membership === "active") {
    return { kind: "member" };
  }
  if (membership === "banned" || input.archived) {
    return { kind: "unavailable" };
  }
  if (input.paidJoin && input.signedIn && input.canRejoin) {
    return { kind: "rejoin" };
  }
  if (input.paidJoin && input.joinMode === "invite" && membership !== "pending") {
    return { kind: "invite_only" };
  }
  if (input.paidJoin) {
    return input.signedIn
      ? { kind: "paid", paidJoin: input.paidJoin }
      : {
          kind: "sign_up",
          intent: "checkout",
          label: input.paidJoin.label,
          yearlyLabel: input.paidJoin.yearlyLabel,
        };
  }
  if (input.joinMode === "invite") {
    return { kind: "invite_only" };
  }
  if (!input.signedIn) {
    return input.joinMode === "approval"
      ? { kind: "sign_up", intent: "request", label: "Request to join" }
      : { kind: "sign_up", intent: "join", label: "Join community" };
  }
  if (request?.status === "pending") {
    return { kind: "pending" };
  }
  if (input.joinMode === "open") {
    return { kind: "join" };
  }
  if (request?.status === "declined") {
    return { kind: "declined", note: request.decisionNote, questions: input.questions };
  }
  return { kind: "request", questions: input.questions };
}

async function canRejoinWithPaidAccess(
  page: CommunityPage,
  status: JoinStatusView | null,
): Promise<boolean> {
  if (page.actor.kind !== "user" || status?.membershipStatus !== "removed") {
    return false;
  }
  try {
    const mine = await getPaymentsService().getMyMembership(page.actor, page.community.id);
    return mine.canRejoin;
  } catch (error) {
    if (error instanceof PaymentsError) return false;
    throw error;
  }
}

export async function loadJoinState(
  page: CommunityPage,
  paidJoin: PaidJoinView | null,
): Promise<JoinState> {
  const status =
    page.actor.kind === "user"
      ? await getManageService().getJoinStatus(page.actor, page.community.id)
      : null;
  const archived = page.access === "full" ? page.community.archivedAt !== null : false;
  return resolveJoinState({
    signedIn: page.actor.kind === "user",
    slug: page.community.slug,
    joinMode: page.community.joinMode,
    questions: page.community.joinQuestions,
    archived,
    paidJoin,
    canRejoin: paidJoin !== null && (await canRejoinWithPaidAccess(page, status)),
    status,
  });
}
