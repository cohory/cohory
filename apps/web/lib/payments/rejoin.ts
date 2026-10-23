import { ForbiddenError, type Actor } from "@cohory/authz";
import { getPaymentsService, PaymentsError } from "@cohory/payments";

export async function rejoinWithPaidAccess(actor: Actor, communityId: string): Promise<boolean> {
  try {
    return (await getPaymentsService().rejoinWithPaidAccess(actor, communityId)).restored;
  } catch (error) {
    if (error instanceof PaymentsError || error instanceof ForbiddenError) return false;
    throw error;
  }
}
