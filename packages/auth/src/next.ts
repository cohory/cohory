import "#server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth, type Session } from "./auth";
import { isDeletionPending, pendingDeletionPath, signInPath } from "./redirects";

export const getSessionIncludingPendingDeletion = cache(async (): Promise<Session | null> => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export const getSession = cache(async (): Promise<Session | null> => {
  const session = await getSessionIncludingPendingDeletion();
  if (session && isDeletionPending(session.user)) {
    redirect(pendingDeletionPath);
  }
  return session;
});

export async function requireSession(returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(signInPath(returnTo));
  }
  return session;
}
