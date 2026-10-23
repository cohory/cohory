import { requireSession } from "@cohory/auth/next";
import { headers } from "next/headers";

export async function requireAccountSession(returnTo = "/account") {
  const session = await requireSession(returnTo);
  return { ...session, headers: await headers() };
}
