"use server";

import { DataExportRateLimitedError } from "@cohory/identity";
import { revalidatePath } from "next/cache";

import { dataExports } from "../../../lib/account/data-export";
import { actorFor } from "../../../lib/actor";
import { requireAccountSession } from "./session";

export type DataExportState =
  { status: "idle" } | { status: "sent"; message: string } | { status: "error"; message: string };

export async function requestDataExport(): Promise<DataExportState> {
  const session = await requireAccountSession();
  try {
    const request = await dataExports().requestExport(actorFor(session));
    revalidatePath("/account");
    return {
      status: "sent",
      message: request.emailed
        ? `We are emailing a download link to ${session.user.email}. It works for 7 days.`
        : "We could not send the email. Download your copy from this page; the link works for 7 days.",
    };
  } catch (error) {
    if (error instanceof DataExportRateLimitedError) {
      return {
        status: "error",
        message:
          "You asked for a copy in the last 24 hours. Use the link in that email, or try again tomorrow.",
      };
    }
    throw error;
  }
}
