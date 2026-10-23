import { getPaymentsService, PaymentsError, type PlanView } from "@cohory/payments";
import { cache } from "react";

export const loadActivePlan = cache(async (communityId: string): Promise<PlanView | null> =>
  getPaymentsService().getPlan({ kind: "guest" }, communityId),
);

export async function paysBySubscription(communityId: string, userId: string): Promise<boolean> {
  try {
    const access = await getPaymentsService().getMembershipAccess(communityId, userId);
    return access.level === "member" && access.source === "subscription";
  } catch (error) {
    if (error instanceof PaymentsError) return false;
    throw error;
  }
}
