"use server";

import { getLegalConfig } from "@cohory/config/legal";
import { getEmailOutbox } from "@cohory/email";
import { clientIp, getRateLimiter, RateLimitedError } from "@cohory/rate-limit";
import { headers } from "next/headers";

import { currentSession } from "../session";
import { parseContentReport } from "./report";
import { deliverContentReport } from "./report-delivery";

export type ReportState =
  { status: "idle" } | { status: "sent"; receipt: boolean } | { status: "error"; message: string };

export async function sendContentReport(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const contact = getLegalConfig().contactEmail;
  if (!contact) {
    return { status: "error", message: "This server does not take reports yet." };
  }
  const parsed = parseContentReport(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the report and try again.",
    };
  }
  try {
    getRateLimiter().consume("report", `legal-report:${clientIp(await headers())}`);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { status: "error", message: "Too many reports. Wait a few minutes and try again." };
    }
    throw error;
  }
  const session = await currentSession();
  const reporter = session
    ? { email: session.user.email, emailVerified: session.user.emailVerified }
    : null;
  const { receipt } = await deliverContentReport(
    getEmailOutbox(),
    contact,
    parsed.data,
    reporter,
    new Date(),
  );
  return { status: "sent", receipt };
}
