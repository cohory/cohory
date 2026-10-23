import type { SubscriberMoveView } from "@cohory/payments";
import { describe, expect, it } from "vitest";

import {
  freeUntilText,
  importedMoves,
  movedFrom,
  notYetListed,
  parseMoveLines,
  type MoveSourceJob,
} from "./moving";

function importJob(fields: Partial<MoveSourceJob>): MoveSourceJob {
  return {
    id: "019a0000-0000-7000-8000-000000000001",
    status: "succeeded",
    finishedAt: new Date("2026-10-20T09:00:00.000Z"),
    preview: null,
    summary: null,
    ...fields,
  };
}

const move = (email: string): SubscriberMoveView => ({
  id: email,
  email,
  source: "skool",
  freeUntil: null,
  state: "not_moved",
  resubscribedAt: null,
  remindedAt: null,
});

describe("importedMoves", () => {
  it("lists the paying members a Skool import flagged", () => {
    const imported = importedMoves([
      importJob({
        preview: {
          source: { importer: { id: "skool" }, name: "Skool", paying: ["ada@example.test"] },
        },
      }),
    ]);
    expect(imported).toMatchObject({
      source: "skool",
      from: "Skool",
      rows: [{ email: "ada@example.test", freeUntil: null }],
    });
    expect(notYetListed(imported, [move("ADA@example.test")])).toBe(0);
    expect(notYetListed(imported, [])).toBe(1);
  });

  it("gives archive members free time until the date they paid for", () => {
    const imported = importedMoves([
      importJob({
        summary: {
          subscriptionLinks: [
            {
              email: "paid@example.test",
              accessState: "granted",
              currentPeriodEnd: "2026-11-18T00:00:00.000Z",
            },
            { email: "lapsed@example.test", accessState: "revoked", currentPeriodEnd: null },
          ],
        },
      }),
    ]);
    expect(imported?.source).toBe("archive");
    expect(imported?.rows).toEqual([
      { email: "paid@example.test", freeUntil: new Date("2026-11-18T00:00:00.000Z") },
    ]);
  });

  it("gives archive members a week of free time when the paid period ended before the import", () => {
    const imported = importedMoves([
      importJob({
        finishedAt: new Date("2026-12-01T09:00:00.000Z"),
        summary: {
          subscriptionLinks: [
            {
              email: "late@example.test",
              accessState: "granted",
              currentPeriodEnd: "2026-11-18T00:00:00.000Z",
            },
          ],
        },
      }),
    ]);
    expect(imported?.rows).toEqual([
      { email: "late@example.test", freeUntil: new Date("2026-12-08T09:00:00.000Z") },
    ]);
  });

  it("ignores imports that did not finish", () => {
    expect(
      importedMoves([
        importJob({
          status: "failed",
          preview: { source: { importer: { id: "skool" }, name: "Skool", paying: ["a@b.c"] } },
        }),
      ]),
    ).toBeNull();
  });
});

describe("parseMoveLines", () => {
  it("reads one address per line with an optional date, falling back to the shared date", () => {
    expect(
      parseMoveLines("Ada@example.test 2026-11-18\nbo@example.test\n\n", "2026-12-01"),
    ).toEqual({
      ok: true,
      rows: [
        { email: "ada@example.test", freeUntil: new Date("2026-11-18T23:59:59.000Z") },
        { email: "bo@example.test", freeUntil: new Date("2026-12-01T23:59:59.000Z") },
      ],
    });
  });

  it("says which line is wrong", () => {
    expect(parseMoveLines("ada@example.test\nnot an email", null)).toEqual({
      ok: false,
      message: "Line 2 has no valid email address.",
    });
    expect(parseMoveLines("ada@example.test 18/11/2026", null)).toEqual({
      ok: false,
      message: "Line 1 has a date that is not YYYY-MM-DD.",
    });
  });
});

describe("movedFrom", () => {
  it("names a platform only when the source is one", () => {
    expect(movedFrom("circle")).toBe("Circle");
    expect(movedFrom("manual")).toBeNull();
  });
});

describe("freeUntilText", () => {
  const format = (date: Date) => date.toISOString().slice(0, 10);

  it("flags rows with no renewal date", () => {
    expect(freeUntilText(null, format)).toBe("No renewal date");
    expect(freeUntilText(new Date("2026-11-18T00:00:00.000Z"), format)).toBe(
      "Free until 2026-11-18",
    );
  });
});
