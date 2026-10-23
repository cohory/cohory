import { z } from "zod";

import { CommunityValidationError } from "../errors";
import type { ManageMemberCursor } from "./repository";

const cursorSchema = z.strictObject({ s: z.iso.datetime(), i: z.uuid() });

export function encodeManageCursor(cursor: ManageMemberCursor): string {
  return Buffer.from(
    JSON.stringify({ s: cursor.sortAt.toISOString(), i: cursor.membershipId }),
  ).toString("base64url");
}

export function decodeManageCursor(raw: string): ManageMemberCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    json = null;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) {
    throw new CommunityValidationError([{ path: "cursor", message: "The cursor is not valid." }]);
  }
  return { sortAt: new Date(parsed.data.s), membershipId: parsed.data.i };
}
