import { randomBytes } from "node:crypto";

import type { Community } from "@cohory/db";
import { verifications } from "@cohory/db/schema";
import { and, eq, like } from "drizzle-orm";

import type { Runtime } from "./runtime";
import { inMigrationScope } from "./scope";

export const passwordLinkLifetimeDays = 7;
const dayMs = 24 * 60 * 60 * 1000;

// Better Auth keeps reset tokens in verifications as `reset-password:{token}` with the user id as
// the value, and confirms the email when the password is set. Issuing one here lets an imported
// person open "choose a password" directly instead of the generic forgot password form. Earlier
// links for the same person are deleted, so only the newest email works.
export async function passwordLink(
  runtime: Runtime,
  community: Community,
  userId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await inMigrationScope(runtime.db, community.id, async ({ tx }) => {
    await tx
      .delete(verifications)
      .where(
        and(eq(verifications.value, userId), like(verifications.identifier, "reset-password:%")),
      );
    await tx.insert(verifications).values({
      identifier: `reset-password:${token}`,
      value: userId,
      expiresAt: new Date(runtime.now().getTime() + passwordLinkLifetimeDays * dayMs),
    });
  });
  const next = encodeURIComponent(`/c/${community.slug}`);
  return `${runtime.config.appUrl}/reset-password?token=${token}&next=${next}`;
}
