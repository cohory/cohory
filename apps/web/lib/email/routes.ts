import {
  emailWebhookMaxBytes,
  emailWebhookSignatureHeader,
  handleEmailWebhook,
  verifyOptOutToken,
  type EmailLog,
  type SuppressionList,
} from "@cohory/email";
import {
  clientIp,
  RateLimitedError,
  type RateLimiter,
  type RateLimitRuleName,
} from "@cohory/rate-limit";

const notificationUnsubscribePath = "/api/v1/notification-preferences/unsubscribe";
const maxTokenLength = 512;

function tokenOf(url: URL): string | null {
  const token = url.searchParams.get("token");
  return token && token.length <= maxTokenLength ? token : null;
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function emailRateLimitWait(
  limiter: RateLimiter | undefined,
  rule: RateLimitRuleName,
  headers: Headers,
): number | null {
  if (!limiter) {
    return null;
  }
  try {
    limiter.consume(rule, clientIp(headers));
    return null;
  } catch (error) {
    if (!(error instanceof RateLimitedError)) throw error;
    return Math.max(1, error.retryAfterSeconds);
  }
}

function limited(
  limiter: RateLimiter | undefined,
  rule: RateLimitRuleName,
  request: Request,
): Response | null {
  const wait = emailRateLimitWait(limiter, rule, request.headers);
  if (wait === null) {
    return null;
  }
  return Response.json(
    { code: "RATE_LIMITED", message: "Too many attempts. Wait a moment and try again." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(wait) } },
  );
}

export function notificationUnsubscribeRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== notificationUnsubscribePath) {
    return null;
  }
  const token = tokenOf(url);
  return seeOther(token ? `/unsubscribe?token=${encodeURIComponent(token)}` : "/unsubscribe");
}

export interface OptOutDeps {
  readonly secret: string;
  readonly list: Pick<SuppressionList, "suppress">;
  readonly now?: Date;
  readonly limiter?: RateLimiter;
}

export function optOutPageRedirect(request: Request): Response {
  const token = tokenOf(new URL(request.url));
  return seeOther(token ? `/email-opt-out?token=${encodeURIComponent(token)}` : "/email-opt-out");
}

export async function optOutWithToken(deps: OptOutDeps, token: string): Promise<boolean> {
  const claim = verifyOptOutToken(deps.secret, token, deps.now);
  if (!claim) {
    return false;
  }
  await deps.list.suppress({
    addressHash: claim.addressHash,
    communityId: claim.communityId,
    reason: "opt_out",
    source: "member",
  });
  return true;
}

export async function handleOneClickOptOut(deps: OptOutDeps, request: Request): Promise<Response> {
  const tooMany = limited(deps.limiter, "emailOptOut", request);
  if (tooMany) {
    return tooMany;
  }
  const token = tokenOf(new URL(request.url));
  if (!token || !(await optOutWithToken(deps, token))) {
    return jsonResponse(422, { error: "This link has expired or is not valid." });
  }
  return jsonResponse(200, { optedOut: true });
}

export interface EmailWebhookDeps {
  readonly secret: string | undefined;
  readonly list: SuppressionList;
  readonly log: EmailLog;
  readonly now?: Date;
  readonly newBatchId?: () => string;
  readonly limiter?: RateLimiter;
}

export async function handleEmailWebhookRequest(
  deps: EmailWebhookDeps,
  request: Request,
): Promise<Response> {
  const tooMany = limited(deps.limiter, "emailWebhook", request);
  if (tooMany) {
    return tooMany;
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > emailWebhookMaxBytes) {
    return jsonResponse(413, { error: "The body is too large." });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > emailWebhookMaxBytes) {
    return jsonResponse(413, { error: "The body is too large." });
  }
  const result = await handleEmailWebhook({
    secret: deps.secret,
    body,
    signature: request.headers.get(emailWebhookSignatureHeader),
    list: deps.list,
    log: deps.log,
    now: deps.now,
    newBatchId: deps.newBatchId,
  });
  switch (result.kind) {
    case "disabled":
      return jsonResponse(404, { error: "Not found." });
    case "unsigned":
      return jsonResponse(401, { error: "The signature is missing, wrong, or too old." });
    case "invalid":
      return jsonResponse(422, { error: result.message });
    case "recorded":
      return jsonResponse(200, { recorded: result.count, batchId: result.batchId });
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
