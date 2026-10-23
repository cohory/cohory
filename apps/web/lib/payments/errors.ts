import type { ErrorAudience } from "@cohory/api/errors";

import { actionFailure } from "../posts/errors";

export type PaymentsAudience = ErrorAudience;

export function paymentsActionFailure(
  error: unknown,
  audience: PaymentsAudience,
): { ok: false; message: string } | null {
  return actionFailure(error, audience);
}
