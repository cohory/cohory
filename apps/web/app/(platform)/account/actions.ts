"use server";

import { logger } from "@cohory/infra/logger";
import { profileNameSchema } from "@cohory/auth/forms";
import {
  AccountConfirmationError,
  AccountDeletionBlockedError,
  getAccountService,
} from "@cohory/identity";
import {
  avatarExtensions,
  avatarKey,
  avatarMaxBytes,
  getStorage,
  StorageError,
  validateAvatar,
} from "@cohory/storage";
import { getRateLimiter } from "@cohory/rate-limit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resendVerification, type VerificationState } from "../../../lib/account/verification";
import { actorFor } from "../../../lib/actor";
import { exitAnswerSchema } from "../../../lib/feedback/exit-reasons";
import { recordExitQuietly } from "../../../lib/feedback/service";
import { requireAccountSession } from "./session";
import { getAppAuth } from "../../../lib/auth/instance";

export type ProfileFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; field: "name" | "avatar" | "form"; message: string; name: string };

export type DeleteAccountState = { status: "idle" } | { status: "error"; message: string };

async function storeAvatar(userId: string, file: File): Promise<string> {
  if (file.size > avatarMaxBytes) {
    throw new StorageError("file_too_large", "The image is over 5 MB. Choose a smaller image.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = validateAvatar({ bytes, declaredType: file.type });
  const storage = getStorage();
  const key = avatarKey(userId, image.extension);
  await storage.put({ key, body: bytes, contentType: image.contentType });
  await Promise.all(
    avatarExtensions
      .filter((extension) => extension !== image.extension)
      .map((extension) => storage.delete(avatarKey(userId, extension))),
  );
  return `${storage.publicUrl(key)}?v=${Date.now()}`;
}

export async function updateProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { user, headers } = await requireAccountSession();

  const submittedName = formData.get("name");
  const typedName = typeof submittedName === "string" ? submittedName : "";
  const name = profileNameSchema.safeParse(typedName);
  if (!name.success) {
    return {
      status: "error",
      field: "name",
      message: name.error.issues[0]?.message ?? "Enter your name.",
      name: typedName,
    };
  }

  const avatar = formData.get("avatar");
  let image: string | undefined;
  if (avatar instanceof File && avatar.size > 0) {
    try {
      image = await storeAvatar(user.id, avatar);
    } catch (error) {
      if (error instanceof StorageError) {
        return { status: "error", field: "avatar", message: error.message, name: typedName };
      }
      logger.error({ userId: user.id }, "avatar upload failed");
      throw error;
    }
  }

  await getAppAuth().api.updateUser({
    headers,
    body: image === undefined ? { name: name.data } : { name: name.data, image },
  });
  revalidatePath("/account");
  return { status: "saved", message: "Changes saved." };
}

export async function requestAccountDeletion(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const session = await requireAccountSession();
  const confirmation = formData.get("confirmation");
  const actor = actorFor(session);
  try {
    await getAccountService().requestDeletion(actor, {
      confirmation: typeof confirmation === "string" ? confirmation : "",
    });
  } catch (error) {
    if (error instanceof AccountConfirmationError) {
      return { status: "error", message: "Type the email address of this account to confirm." };
    }
    if (error instanceof AccountDeletionBlockedError) {
      return {
        status: "error",
        message:
          "Transfer, archive, or end billing for the communities you own before you delete your account.",
      };
    }
    throw error;
  }
  await recordExitQuietly(
    actor,
    { communityId: null, action: "delete_account" },
    exitAnswerSchema.parse({
      reason: formData.get("exitReason") || null,
      comment: formData.get("exitComment") ?? "",
    }),
  );
  redirect("/sign-in?notice=deletion-scheduled");
}

export async function resendVerificationAction(
  _previous: VerificationState,
): Promise<VerificationState> {
  const { user, headers } = await requireAccountSession();
  return resendVerification(user, {
    consume: (userId) => getRateLimiter().consume("passwordReset", `verify-email:${userId}`),
    send: async (email) => {
      await getAppAuth().api.sendVerificationEmail({
        body: { email, callbackURL: "/account/notifications" },
        headers,
      });
    },
  });
}
