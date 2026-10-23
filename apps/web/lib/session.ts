import type { Session } from "@cohory/auth";
import { getSession, requireSession } from "@cohory/auth/next";

export async function currentSession(): Promise<Session | null> {
  return getSession();
}

export async function requireCurrentSession(returnTo: string): Promise<Session> {
  return requireSession(returnTo);
}
