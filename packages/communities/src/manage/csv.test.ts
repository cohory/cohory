import { describe, expect, it } from "vitest";

import {
  csvBom,
  csvField,
  csvRow,
  membersCsvColumns,
  membersCsvFilename,
  membersCsvRow,
} from "./csv";

describe("csvField", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line\nbreak", '"line\nbreak"'],
    ["carriage\rreturn", '"carriage\rreturn"'],
    ["", ""],
    ["Zoë 張", "Zoë 張"],
  ])("quotes %j as %j per RFC 4180", (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  it("writes null as an empty field and numbers as digits", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(42)).toBe("42");
  });

  it.each(["=SUM(A1:A2)", "+1", "-2", "@cmd", "\tx"])(
    "prefixes a spreadsheet formula trigger in %j with an apostrophe",
    (input) => {
      expect(csvField(input).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("quotes a neutralized formula that also contains a comma", () => {
    expect(csvField("=A1,B1")).toBe(`"'=A1,B1"`);
  });
});

describe("csvRow", () => {
  it("joins fields with commas and ends with CRLF", () => {
    expect(csvRow(["a", null, 3, "b,c"])).toBe('a,,3,"b,c"\r\n');
  });
});

describe("members CSV", () => {
  it("has the documented columns in order", () => {
    expect(membersCsvColumns).toEqual([
      "email",
      "name",
      "username",
      "role",
      "joined_at",
      "level",
      "points",
      "status",
      "stripe_customer_id",
      "stripe_subscription_id",
      "last_active_at",
      "access",
      "signed_in",
    ]);
  });

  it("starts with a UTF-8 byte order mark", () => {
    expect(csvBom).toBe("﻿");
  });

  it("writes a member row with empty Stripe columns, the access, and whether they signed in", () => {
    expect(
      membersCsvRow(
        {
          email: "ada@example.test",
          name: "Ada, Countess",
          username: null,
          role: "admin",
          joinedAt: new Date("2026-10-18T09:30:00.000Z"),
          level: 3,
          points: 120,
          status: "active",
          lastActiveAt: new Date("2026-10-19T08:00:00.000Z"),
          signedIn: true,
        },
        "paying_yearly",
      ),
    ).toBe(
      'ada@example.test,"Ada, Countess",,admin,2026-10-18T09:30:00.000Z,3,120,active,,,2026-10-19T08:00:00.000Z,paying_yearly,yes\r\n',
    );
  });

  it("leaves the access column empty for people who cannot see payments", () => {
    const row = membersCsvRow(
      {
        email: "bo@example.test",
        name: "Bo",
        username: "bo",
        role: "member",
        joinedAt: null,
        level: 1,
        points: 0,
        status: "active",
        lastActiveAt: new Date("2026-10-19T08:00:00.000Z"),
        signedIn: false,
      },
      null,
    );

    expect(row.endsWith(",2026-10-19T08:00:00.000Z,,no\r\n")).toBe(true);
  });

  it("names the file after the slug and the UTC date", () => {
    expect(membersCsvFilename("makers-guild", new Date("2026-10-18T23:59:00Z"))).toBe(
      "makers-guild-members-2026-10-18.csv",
    );
  });
});
