import { z } from "zod";

import { NotificationValidationError } from "./errors";

export interface NotificationCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const cursorSchema = z.strictObject({ c: z.iso.datetime(), i: z.uuid() });

export function encodeCursor(cursor: NotificationCursor): string {
  const json = JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id });
  return Buffer.from(json).toString("base64url");
}

export function decodeCursor(raw: string): NotificationCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    json = null;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) {
    throw new NotificationValidationError([
      { path: "cursor", message: "The cursor is not valid." },
    ]);
  }
  return { createdAt: new Date(parsed.data.c), id: parsed.data.i };
}
