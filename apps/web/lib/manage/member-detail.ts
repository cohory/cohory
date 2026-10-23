import { getManageService, MembershipNotFoundError } from "@cohory/communities";
import { getPaymentsService, type MemberBilling } from "@cohory/payments";
import { z } from "zod";

import { toPersonRow, type PersonRow, type Viewer } from "./views";

export interface MemberDetail {
  readonly row: PersonRow;
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
  readonly requestedAt: string | null;
  readonly billing: MemberBilling | null;
}

const billedAccess = new Set(["paying_monthly", "paying_yearly", "past_due", "cancelling"]);

export async function loadMemberDetail(
  viewer: Viewer,
  communityId: string,
  userId: string,
): Promise<MemberDetail | null> {
  if (!z.uuid().safeParse(userId).success) {
    return null;
  }
  try {
    const detail = await getManageService().getMemberForManage(viewer.actor, communityId, userId);
    const row = toPersonRow(viewer, detail.member);
    const billing =
      row.access !== null && billedAccess.has(row.access)
        ? await getPaymentsService().getMemberBilling(viewer.actor, communityId, userId)
        : null;
    return {
      row,
      answers: detail.answers.map((answer) => ({ ...answer })),
      requestedAt: detail.requestedAt?.toISOString() ?? null,
      billing,
    };
  } catch (error) {
    if (error instanceof MembershipNotFoundError) {
      return null;
    }
    throw error;
  }
}
