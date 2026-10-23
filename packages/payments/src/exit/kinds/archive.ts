import {
  paidMembershipEvents,
  type PaidMembershipChange,
  type PaidMembershipEvent,
  type PaidMembershipNoticeInput,
} from "../events";
import type { ExitKindHook, ExitRunFinish } from "./types";

function eventsFor(
  finish: ExitRunFinish,
  change: PaidMembershipChange,
  recipients: PaidMembershipNoticeInput["recipients"],
): PaidMembershipEvent[] {
  return paidMembershipEvents({
    noticeId: finish.run.id,
    communityId: finish.community.id,
    communitySlug: finish.community.slug,
    communityName: finish.community.name,
    actorId: finish.actorId,
    change,
    supportContact: null,
    portalLoginUrl: null,
    recipients,
  });
}

export const archiveFinished: ExitKindHook = async (finish) => {
  const keepBilling = finish.run.choice === "keep_billing";
  const ending = keepBilling ? [] : finish.completed;
  const continuing = keepBilling
    ? [...finish.completed.map((target) => target.subscription), ...finish.leftRunning]
    : finish.leftRunning;
  const events = [
    ...eventsFor(
      finish,
      "archived_ending",
      ending.map((target) => ({ userId: target.subscription.userId, endsAt: target.endsAt })),
    ),
    ...eventsFor(
      finish,
      "archived_continuing",
      continuing.map((subscription) => ({ userId: subscription.userId, endsAt: null })),
    ),
  ];
  if (events.length > 0) {
    await finish.store.exit.appendNotices(events, "community");
  }
};
