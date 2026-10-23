import { z } from "zod";

import { MembersValidationError } from "./errors";
import type { MemberCursor } from "./repository";

const cursorSchema = z.strictObject({ j: z.iso.datetime(), i: z.uuid() });

export function encodeMemberCursor(cursor: MemberCursor): string {
  return Buffer.from(
    JSON.stringify({ j: cursor.joinedAt.toISOString(), i: cursor.membershipId }),
  ).toString("base64url");
}

export function decodeMemberCursor(raw: string): MemberCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    json = null;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) {
    throw new MembersValidationError([{ path: "cursor", message: "The cursor is not valid." }]);
  }
  return { joinedAt: new Date(parsed.data.j), membershipId: parsed.data.i };
}
