import { describe, expect, it } from "vitest";

import { hiddenLines, reviewCountLabel, toReviewRow } from "./views";

describe("review views", () => {
  it("says how many reviews the owner hid and why", () => {
    expect(
      hiddenLines({
        status: "enabled",
        count: 4,
        average: 4.5,
        ratings: [],
        hidden: [
          { reason: "spam", count: 1 },
          { reason: "personal_data", count: 2 },
        ],
      }),
    ).toEqual([
      "1 review hidden by the owner for: spam",
      "2 reviews hidden by the owner for: personal data",
    ]);
    expect(hiddenLines({ status: "disabled" })).toEqual([]);
  });

  it("marks the viewer's own review and an edited reply", () => {
    const createdAt = new Date("2026-10-01T10:00:00Z");
    const row = toReviewRow(
      {
        id: "0192f0a0-0000-7000-8000-000000000001",
        rating: 4,
        body: "Helpful calls every single week.",
        author: { id: "0192f0a0-0000-7000-8000-000000000002", name: "Ada", image: null },
        status: { kind: "former" },
        statusLabel: "Former member",
        createdAt,
        editedAt: createdAt,
        reply: { body: "Thanks", createdAt, editedAt: createdAt },
      },
      "0192f0a0-0000-7000-8000-000000000002",
    );
    expect(row).toMatchObject({
      own: true,
      edited: true,
      statusLabel: "Former member",
      createdAt: "2026-10-01T10:00:00.000Z",
      reply: { body: "Thanks", edited: true },
    });
  });

  it("counts reviews in plain words", () => {
    expect(reviewCountLabel(1)).toBe("1 review");
    expect(reviewCountLabel(12)).toBe("12 reviews");
  });
});
