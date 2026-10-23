import { z } from "zod";

const cursorSchema = z.strictObject({ at: z.iso.datetime(), id: z.uuid() });

export interface DeliveryCursor {
  readonly at: Date;
  readonly id: string;
}

export function encodeDeliveryCursor(cursor: DeliveryCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at.toISOString(), id: cursor.id })).toString(
    "base64url",
  );
}

export function decodeDeliveryCursor(value: string): DeliveryCursor | null {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? { at: new Date(parsed.data.at), id: parsed.data.id } : null;
  } catch {
    return null;
  }
}
