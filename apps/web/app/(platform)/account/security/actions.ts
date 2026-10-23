"use server";

import { getAccountService } from "@cohory/identity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actorFor } from "../../../../lib/actor";
import { requireAccountSession } from "../session";

const sessionIdSchema = z.uuid();

export async function revokeSessionAction(sessionId: string): Promise<void> {
  const session = await requireAccountSession("/account/security");
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (parsed.success && parsed.data !== session.session.id) {
    await getAccountService().revokeSession(actorFor(session), parsed.data);
  }
  revalidatePath("/account/security");
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const session = await requireAccountSession("/account/security");
  await getAccountService().revokeOtherSessions(actorFor(session), session.session.id);
  revalidatePath("/account/security");
}
