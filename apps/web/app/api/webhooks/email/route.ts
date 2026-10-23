import { emailWebhookSecretFromEnv, getEmailLog, getSuppressionList } from "@cohory/email";
import { getRateLimiter } from "@cohory/rate-limit";

import { handleEmailWebhookRequest } from "../../../../lib/email/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleEmailWebhookRequest(
    {
      secret: emailWebhookSecretFromEnv(),
      list: getSuppressionList(),
      log: getEmailLog(),
      limiter: getRateLimiter(),
    },
    request,
  );
}
