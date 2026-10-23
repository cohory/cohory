import { cookies } from "next/headers";

import { classroomHref } from "./hrefs";

export const memberPreviewCookie = "cohory_member_preview";

export function memberPreviewCookieOptions(slug: string) {
  return {
    path: classroomHref(slug),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function readMemberPreview(): Promise<boolean> {
  return (await cookies()).get(memberPreviewCookie)?.value === "1";
}
