"use server";

import { getMembersService } from "@cohory/members";
import type { MemberListItem } from "@cohory/ui";
import { revalidatePath } from "next/cache";

import { actorFor } from "../actor";
import { resolveCommunity } from "../posts/context";
import type { ActionResult } from "../posts/errors";
import { currentSession } from "../session";
import { membersActionFailure } from "./errors";
import {
  searchMembersActionSchema,
  updateBioActionSchema,
  usernameFormSchema,
  type SearchMembersActionInput,
  type UpdateBioActionInput,
} from "./schemas";
import { toMemberListItems } from "./views";

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const failure = membersActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export async function loadMoreMembersAction(
  raw: SearchMembersActionInput,
): Promise<ActionResult<{ members: MemberListItem[]; nextCursor: string | null }>> {
  return guard(async () => {
    const input = searchMembersActionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const page = await getMembersService().searchMembers(
      context.access.actor,
      context.communityId,
      {
        query: input.query || undefined,
        level: input.level ?? undefined,
        cursor: input.cursor,
      },
    );
    return { members: toMemberListItems(context.slug, page.data), nextCursor: page.nextCursor };
  });
}

export async function updateBioAction(
  raw: UpdateBioActionInput,
): Promise<ActionResult<{ bio: string | null }>> {
  return guard(async () => {
    const input = updateBioActionSchema.parse(raw);
    const context = await resolveCommunity(input.slug);
    const profile = await getMembersService().updateMyProfile(
      context.access.actor,
      context.communityId,
      { bio: input.bio || null },
    );
    revalidatePath(`/c/${context.slug}/members`, "layout");
    return { bio: profile.bio };
  });
}

export type UsernameFormState =
  | { status: "idle" }
  | { status: "saved"; username: string; message: string }
  | { status: "error"; message: string };

export async function setUsernameAction(
  _previous: UsernameFormState,
  formData: FormData,
): Promise<UsernameFormState> {
  const session = await currentSession();
  if (!session) return { status: "error", message: "Sign in to continue." };
  const parsed = usernameFormSchema.safeParse({ username: formData.get("username") ?? "" });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid username.",
    };
  }
  const result = await guard(() =>
    getMembersService().setUsername(actorFor(session), { username: parsed.data.username }),
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/", "layout");
  return {
    status: "saved",
    username: result.data.username,
    message: "Username saved.",
  };
}
