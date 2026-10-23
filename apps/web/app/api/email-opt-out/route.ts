import { getSuppressionList, optOutSecretFromEnv } from "@cohory/email";
import { getRateLimiter } from "@cohory/rate-limit";

import { handleOneClickOptOut, optOutPageRedirect } from "../../../lib/email/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return optOutPageRedirect(request);
}

export function POST(request: Request): Promise<Response> {
  return handleOneClickOptOut(
    { secret: optOutSecretFromEnv(), list: getSuppressionList(), limiter: getRateLimiter() },
    request,
  );
}
