import { describe, expect, it } from "vitest";

import { MigrationError } from "../errors";
import { parseCsv, parseMembersCsv } from "./parse";

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes, CRLF line ends, and a byte order mark", () => {
    expect(parseCsv('﻿email,name\r\n"a@x.test","Lovelace, ""Ada"""\r\n')).toEqual([
      ["email", "name"],
      ["a@x.test", 'Lovelace, "Ada"'],
    ]);
  });

  it("refuses a quoted field that is never closed", () => {
    expect(() => parseCsv('email\n"a@x.test')).toThrow(MigrationError);
  });
});

describe("parseMembersCsv", () => {
  it("validates every row and reports errors with their line numbers", () => {
    const result = parseMembersCsv(
      [
        "Email,Name,Role",
        "ADA@example.test,Ada,admin",
        "not-an-email,Bob,member",
        "ada@example.test,Ada again,member",
        "grace@example.test,,owner",
        "linus@example.test,'=Linus,",
        "kay@example.test,Kay,guest",
      ].join("\n"),
      100,
    );

    expect(result.rows).toEqual([
      { line: 2, email: "ada@example.test", name: "Ada", role: "admin" },
      { line: 6, email: "linus@example.test", name: "=Linus", role: "member" },
    ]);
    expect(result.owners).toEqual([{ line: 5, email: "grace@example.test", name: null }]);
    expect(result.errors.map((error) => [error.line, error.message])).toEqual([
      [3, "This is not a valid email address."],
      [4, "This email appears earlier in the file."],
      [7, "Use member, moderator, or admin as the role."],
    ]);
    expect(result.errors[0]?.values).toEqual({
      Email: "not-an-email",
      Name: "Bob",
      Role: "member",
    });
  });

  it("accepts common email headers and joins first and last names", () => {
    const result = parseMembersCsv(
      ["Email Address,First Name,Last Name", "ada@example.test,Ada,Lovelace", "b@x.test,,"].join(
        "\n",
      ),
      10,
    );
    expect(result.rows).toEqual([
      { line: 2, email: "ada@example.test", name: "Ada Lovelace", role: "member" },
      { line: 3, email: "b@x.test", name: null, role: "member" },
    ]);
    expect(result.emailColumn).toBeNull();
    expect(parseMembersCsv("E-mail\na@x.test", 10).rows).toHaveLength(1);
  });

  it("finds the column that holds emails when no header names it", () => {
    const result = parseMembersCsv(["Contact,Who", "a@x.test,Ada", "b@x.test,Bob"].join("\n"), 10);
    expect(result.emailColumn).toBe("Contact");
    expect(result.rows.map((row) => [row.email, row.name])).toEqual([
      ["a@x.test", null],
      ["b@x.test", null],
    ]);
  });

  it("leaves out rows whose status is not active and says why", () => {
    const result = parseMembersCsv(
      ["email,name,status", "a@x.test,Ada,active", "b@x.test,Bob,banned", "c@x.test,Cy,"].join(
        "\n",
      ),
      10,
    );
    expect(result.rows.map((row) => row.email)).toEqual(["a@x.test", "c@x.test"]);
    expect(result.leftOut).toEqual([
      {
        line: 3,
        email: "b@x.test",
        name: "Bob",
        message: "The status in the file is banned, so this row is left out.",
      },
    ]);
  });

  it("needs an email column and refuses files over the row limit", () => {
    expect(() => parseMembersCsv("name\nAda", 10)).toThrow(
      "No column holds email addresses. Name the email column Email and try again.",
    );
    expect(() => parseMembersCsv("email\na@x.test\nb@x.test", 1)).toThrow(
      "The file has more than 1 rows.",
    );
  });
});
