import type { CommunityRecord, ConnectionRecord, PaymentsStore } from "../../repository";
import {
  feeClearRequiredEvent,
  paidMembershipEvents,
  type PaidMembershipChange,
  type PaidMembershipEvent,
} from "../events";
import { selectExitTargets } from "../rules";
import type { ExitRunRecord } from "../store";
import type { ExitKindHook } from "./types";

export interface DisconnectRecipient {
  readonly userId: string;
  readonly endsAt: Date | null;
}

export interface DisconnectNoticeInput {
  readonly run: Pick<ExitRunRecord, "id" | "portalLoginUrl">;
  readonly community: CommunityRecord;
  readonly actorId: string;
  readonly ending: readonly DisconnectRecipient[];
  readonly continuing: readonly DisconnectRecipient[];
  readonly feeClearRequired: boolean;
  readonly contactUserId?: string | null;
}

export async function closeConnection(
  store: PaymentsStore,
  connection: ConnectionRecord,
  now: Date,
): Promise<ConnectionRecord> {
  const plan = await store.findActivePlan();
  if (plan && plan.connectionId === connection.id) {
    await store.updatePlan(plan.id, { archivedAt: now });
    await store.setCommunityCurrency(null);
  }
  if (connection.status === "disconnected") {
    return connection;
  }
  return store.updateConnection(connection.id, { status: "disconnected", disconnectedAt: now });
}

export async function appendDisconnectNotices(
  store: PaymentsStore,
  input: DisconnectNoticeInput,
): Promise<void> {
  const ownerId = await store.findOwnerId();
  const contactId = input.contactUserId ?? ownerId;
  const supportContact = contactId ? await store.findUserEmail(contactId) : null;
  const base = {
    noticeId: input.run.id,
    communityId: input.community.id,
    communitySlug: input.community.slug,
    communityName: input.community.name,
    actorId: input.actorId,
    supportContact,
    portalLoginUrl: input.run.portalLoginUrl,
  };
  const notice = (change: PaidMembershipChange, recipients: readonly DisconnectRecipient[]) =>
    paidMembershipEvents({ ...base, change, recipients });
  const events: PaidMembershipEvent[] = [
    ...notice("winding_down", input.ending),
    ...notice("billed_by_creator", input.continuing),
  ];
  if (input.feeClearRequired && ownerId) {
    events.push(
      feeClearRequiredEvent({
        noticeId: input.run.id,
        communityId: input.community.id,
        communitySlug: input.community.slug,
        communityName: input.community.name,
        ownerId,
      }),
    );
  }
  if (events.length > 0) {
    await store.exit.appendNotices(events, "community");
  }
}

export async function closeAfterDisconnect(
  store: PaymentsStore,
  input: DisconnectNoticeInput & { readonly connectionId: string | null; readonly now: Date },
): Promise<ConnectionRecord | null> {
  const open = await store.findOpenConnection();
  const matching = open && open.id === input.connectionId ? open : null;
  const closed = matching ? await closeConnection(store, matching, input.now) : null;
  await appendDisconnectNotices(store, {
    ...input,
    contactUserId: input.contactUserId ?? matching?.acceptedOwnerId ?? null,
  });
  return closed;
}

export async function recipientsFromMirror(
  store: PaymentsStore,
  run: Pick<ExitRunRecord, "connectionId" | "choice" | "includeLinked">,
): Promise<Pick<DisconnectNoticeInput, "ending" | "continuing">> {
  const subs = await store.exit.listExitSubscriptions(run.connectionId);
  const { targets, leftRunning } = selectExitTargets(subs, run.includeLinked);
  const windDown = run.choice === "wind_down";
  const ending = targets.filter((sub) => windDown && sub.cancelAtPeriodEnd);
  const continuing = [...targets.filter((sub) => !ending.includes(sub)), ...leftRunning];
  return {
    ending: ending.map((sub) => ({ userId: sub.userId, endsAt: sub.currentPeriodEnd })),
    continuing: continuing.map((sub) => ({ userId: sub.userId, endsAt: null })),
  };
}

export const disconnectFinished: ExitKindHook = async (finish) => {
  if (finish.status !== "done") {
    return;
  }
  const windDown = finish.run.choice === "wind_down";
  const completed = finish.completed.map((target) => ({
    userId: target.subscription.userId,
    endsAt: target.endsAt,
  }));
  await closeAfterDisconnect(finish.store, {
    run: finish.run,
    connectionId: finish.run.connectionId,
    community: finish.community,
    actorId: finish.actorId,
    ending: windDown ? completed : [],
    continuing: [
      ...(windDown ? [] : completed.map((target) => ({ ...target, endsAt: null }))),
      ...finish.leftRunning.map((sub) => ({ userId: sub.userId, endsAt: null })),
    ],
    feeClearRequired: false,
    now: finish.now,
  });
};
