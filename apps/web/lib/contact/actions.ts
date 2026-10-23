"use server";

import { clientIp } from "@cohory/rate-limit";
import { headers } from "next/headers";

import { currentSession } from "../session";
import { contactAccount, getContactService } from "./service";

export interface ContactValues {
  readonly name: string;
  readonly email: string;
  readonly topic: string;
  readonly message: string;
  readonly link: string;
}

export type ContactState =
  | { readonly status: "idle"; readonly token: string }
  | { readonly status: "sent" }
  | {
      readonly status: "error";
      readonly message: string;
      readonly token: string;
      readonly values: ContactValues;
    };

const fields = ["name", "email", "topic", "message", "link", "website", "token"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function sendContactMessage(
  _previous: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const service = getContactService();
  const form = Object.fromEntries(fields.map((name) => [name, text(formData, name)]));
  const session = await currentSession();
  const result = await service.submit({
    form,
    ip: clientIp(await headers()),
    account: session ? await contactAccount(session) : null,
  });
  if (result.status === "sent") {
    return { status: "sent" };
  }
  return {
    status: "error",
    message: result.message,
    token:
      result.code === "expired" || result.code === "bad_token"
        ? service.issueFormToken()
        : text(formData, "token"),
    values: {
      name: text(formData, "name"),
      email: text(formData, "email"),
      topic: text(formData, "topic"),
      message: text(formData, "message"),
      link: text(formData, "link"),
    },
  };
}
