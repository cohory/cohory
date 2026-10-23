import { paidThrough } from "@cohory/migration";
import type { SubscriberMoveState, SubscriberMoveView } from "@cohory/payments";
import { z } from "zod";

export type MoveSource = SubscriberMoveView["source"];

export interface ImportedMoves {
  readonly jobId: string;
  readonly source: MoveSource;
  readonly from: string;
  readonly rows: readonly { readonly email: string; readonly freeUntil: Date | null }[];
}

const platformNames: Partial<Record<MoveSource, string>> = { skool: "Skool", circle: "Circle" };

export function movedFrom(source: MoveSource): string | null {
  return platformNames[source] ?? null;
}

export interface MoveSourceJob {
  readonly id: string;
  readonly status: string;
  readonly finishedAt: Date | null;
  readonly preview: {
    readonly source?: {
      readonly importer: { readonly id: MoveSource };
      readonly name: string;
      readonly paying: readonly string[];
    };
  } | null;
  readonly summary: {
    readonly subscriptionLinks: readonly {
      readonly email: string;
      readonly accessState: string;
      readonly currentPeriodEnd: string | null;
    }[];
  } | null;
}

export function importedMoves(imports: readonly MoveSourceJob[]): ImportedMoves | null {
  const job = imports.find((entry) => entry.status === "succeeded");
  if (!job) return null;
  const source = job.preview?.source;
  if (source) {
    const id = source.importer.id;
    return source.paying.length > 0
      ? {
          jobId: job.id,
          source: id,
          from: source.name,
          rows: source.paying.map((email) => ({ email, freeUntil: null })),
        }
      : null;
  }
  const restoredAt = job.finishedAt ?? new Date(0);
  const rows = (job.summary?.subscriptionLinks ?? [])
    .filter((link) => link.accessState === "granted" || link.accessState === "grace")
    .map((link) => ({
      email: link.email,
      freeUntil: paidThrough(link.currentPeriodEnd, restoredAt),
    }));
  return rows.length > 0
    ? { jobId: job.id, source: "archive", from: "your Cohory archive", rows }
    : null;
}

export function notYetListed(
  imported: ImportedMoves | null,
  moves: readonly SubscriberMoveView[],
): number {
  if (!imported) return 0;
  const listed = new Set(moves.map((move) => move.email.toLowerCase()));
  return imported.rows.filter((row) => !listed.has(row.email.toLowerCase())).length;
}

export function freeUntilText(freeUntil: Date | null, format: (date: Date) => string): string {
  return freeUntil ? `Free until ${format(freeUntil)}` : "No renewal date";
}

export const moveStateLabels: Readonly<Record<SubscriberMoveState, string>> = {
  not_moved: "Not moved yet",
  moved: "Moved. Cancel their old subscription",
  free_time_ended: "Free time ended",
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailSchema = z.email().max(320);

export function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59.000Z`);
}

export type ParsedMoveLines =
  | { readonly ok: true; readonly rows: { email: string; freeUntil: Date | null }[] }
  | { readonly ok: false; readonly message: string };

export function parseMoveLines(text: string, fallbackDay: string | null): ParsedMoveLines {
  const rows: { email: string; freeUntil: Date | null }[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const [index, line] of lines.entries()) {
    const [email = "", day = fallbackDay ?? ""] = line.split(/[\s,;]+/);
    if (!emailSchema.safeParse(email).success) {
      return { ok: false, message: `Line ${index + 1} has no valid email address.` };
    }
    if (day !== "" && !datePattern.test(day)) {
      return { ok: false, message: `Line ${index + 1} has a date that is not YYYY-MM-DD.` };
    }
    rows.push({ email: email.toLowerCase(), freeUntil: day ? endOfDay(day) : null });
  }
  if (rows.length === 0) {
    return { ok: false, message: "Add at least one email address." };
  }
  return { ok: true, rows };
}
