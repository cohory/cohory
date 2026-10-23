"use server";

import type { EarlyAccessField } from "@cohory/notifications/early-access";
import { clientIp } from "@cohory/rate-limit";
import { headers } from "next/headers";

import { currentSession } from "../session";
import { getEarlyAccessService } from "./service";

export interface EarlyAccessValues {
  readonly email: string;
  readonly platform: string;
  readonly members: string;
  readonly note: string;
}

export type EarlyAccessState =
  | { readonly status: "idle"; readonly token: string }
  | { readonly status: "done" }
  | {
      readonly status: "invalid";
      readonly field: EarlyAccessField;
      readonly message: string;
      readonly token: string;
      readonly values: EarlyAccessValues;
    };

const fields = ["email", "platform", "members", "note", "website", "token"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function requestEarlyAccess(
  _previous: EarlyAccessState,
  formData: FormData,
): Promise<EarlyAccessState> {
  const form = Object.fromEntries(fields.map((name) => [name, text(formData, name)]));
  const session = await currentSession();
  const result = await getEarlyAccessService().submit({
    form,
    ip: clientIp(await headers()),
    account: session ? { id: session.user.id, email: session.user.email } : null,
  });
  if (result.status !== "invalid") {
    return { status: "done" };
  }
  return {
    status: "invalid",
    field: result.field,
    message: result.message,
    token: text(formData, "token"),
    values: {
      email: text(formData, "email"),
      platform: text(formData, "platform"),
      members: text(formData, "members"),
      note: text(formData, "note"),
    },
  };
}
