"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { withNext } from "../../../lib/auth/form-links";
import {
  inviteAcceptPath,
  inviteIntentCookieValue,
  joinIntentCookie,
  joinIntentMaxAgeSeconds,
} from "../../../lib/communities/join-intent";
import { currentSession } from "../../../lib/session";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const viaSchema = z.enum(["sign-up", "sign-in"]);

export async function startInviteJoinAction(token: unknown, formData: FormData): Promise<void> {
  const parsedToken = tokenSchema.safeParse(token);
  if (!parsedToken.success) {
    redirect("/");
  }
  const via = viaSchema.catch("sign-in").parse(formData.get("via"));
  const jar = await cookies();
  jar.set(joinIntentCookie, inviteIntentCookieValue(parsedToken.data), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: joinIntentMaxAgeSeconds,
  });
  const next = inviteAcceptPath(parsedToken.data);
  if (await currentSession()) {
    redirect(next);
  }
  redirect(withNext(`/${via}`, next));
}
