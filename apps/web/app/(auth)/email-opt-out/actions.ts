"use server";

import { getSuppressionList, optOutSecretFromEnv } from "@cohory/email";
import { getRateLimiter } from "@cohory/rate-limit";
import { headers } from "next/headers";

import { emailRateLimitWait, optOutWithToken } from "../../../lib/email/routes";

export type OptOutState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "invalid" }
  | { status: "limited"; retryAfterSeconds: number };

export async function confirmOptOut(
  _previous: OptOutState,
  formData: FormData,
): Promise<OptOutState> {
  const token = formData.get("token");
  if (typeof token !== "string" || token.length > 512) {
    return { status: "invalid" };
  }
  const wait = emailRateLimitWait(getRateLimiter(), "emailOptOut", await headers());
  if (wait !== null) {
    return { status: "limited", retryAfterSeconds: wait };
  }
  const done = await optOutWithToken(
    { secret: optOutSecretFromEnv(), list: getSuppressionList() },
    token,
  );
  return { status: done ? "done" : "invalid" };
}
