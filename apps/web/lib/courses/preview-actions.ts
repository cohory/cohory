"use server";

import { cookies } from "next/headers";

import { memberPreviewCookie, memberPreviewCookieOptions } from "./preview";
import { memberPreviewSchema, type MemberPreviewInput } from "./schemas";

export async function setMemberPreviewAction(raw: MemberPreviewInput): Promise<void> {
  const input = memberPreviewSchema.parse(raw);
  const store = await cookies();
  const options = memberPreviewCookieOptions(input.slug);
  if (input.on) {
    store.set(memberPreviewCookie, "1", options);
    return;
  }
  store.delete({ name: memberPreviewCookie, ...options });
}
