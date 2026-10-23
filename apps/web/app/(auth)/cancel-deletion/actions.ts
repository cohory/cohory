"use server";

import { isDeletionPending } from "@cohory/auth";
import { getSessionIncludingPendingDeletion } from "@cohory/auth/next";
import { getAccountService } from "@cohory/identity";
import { redirect } from "next/navigation";

import { actorFor } from "../../../lib/actor";

export async function cancelDeletion(): Promise<void> {
  const session = await getSessionIncludingPendingDeletion();
  if (!session) {
    redirect("/sign-in");
  }
  if (isDeletionPending(session.user)) {
    await getAccountService().cancelDeletion(actorFor(session));
  }
  redirect("/");
}
