import { z } from "zod";

import { MigrationError } from "../errors";

export const membersCsvRoles = ["member", "moderator", "admin"] as const;
export type MembersCsvRole = (typeof membersCsvRoles)[number];

export interface CsvMemberRow {
  readonly line: number;
  readonly email: string;
  readonly name: string | null;
  readonly role: MembersCsvRole;
}

export interface CsvRowError {
  readonly line: number;
  readonly email: string;
  readonly message: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface CsvOwnerRow {
  readonly line: number;
  readonly email: string;
  readonly name: string | null;
}

export interface CsvLeftOutRow {
  readonly line: number;
  readonly email: string;
  readonly name: string | null;
  readonly message: string;
}

export interface ParsedMembersCsv {
  readonly rows: readonly CsvMemberRow[];
  readonly owners: readonly CsvOwnerRow[];
  readonly leftOut: readonly CsvLeftOutRow[];
  readonly errors: readonly CsvRowError[];
  readonly emailColumn: string | null;
}

export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const headers = {
  email: ["email", "emailaddress", "mail", "memberemail", "useremail", "contactemail"],
  name: ["name", "fullname", "displayname", "membername"],
  firstName: ["firstname", "givenname"],
  lastName: ["lastname", "surname", "familyname"],
  role: ["role"],
  status: ["status", "membershipstatus"],
} as const;

const emailGuessSample = 50;

const emailSchema = z.email().max(254);
const nameMaxLength = 100;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.startsWith("﻿") ? 1 : 0;
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += char;
    }
    index += 1;
  }
  if (quoted) {
    throw new MigrationError("invalid_csv", "A quoted field is not closed.");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function stripFormulaGuard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function columnOf(keys: readonly string[], aliases: readonly string[]): number {
  return keys.findIndex((key) => aliases.includes(key));
}

function guessEmailColumn(body: readonly (readonly string[])[], width: number): number {
  const sample = body.slice(0, emailGuessSample);
  for (let column = 0; column < width; column += 1) {
    const values = sample.map((cells) => (cells[column] ?? "").trim()).filter(Boolean);
    const emails = values.filter((value) => emailSchema.safeParse(value.toLowerCase()).success);
    if (values.length > 0 && emails.length * 5 >= values.length * 4) return column;
  }
  return -1;
}

export function parseMembersCsv(text: string, maxRows: number): ParsedMembersCsv {
  const table = parseCsv(text);
  const [header, ...body] = table;
  if (!header) {
    throw new MigrationError("invalid_csv", "The file is empty.");
  }
  const names = header.map((cell) => cell.trim());
  const keys = names.map(normalizeKey);
  let emailIndex = columnOf(keys, headers.email);
  let emailColumn: string | null = null;
  if (emailIndex === -1) {
    emailIndex = guessEmailColumn(body, header.length);
    if (emailIndex === -1) {
      throw new MigrationError(
        "invalid_csv",
        "No column holds email addresses. Name the email column Email and try again.",
      );
    }
    emailColumn = names[emailIndex] ?? null;
  }
  if (body.length > maxRows) {
    throw new MigrationError("invalid_csv", `The file has more than ${maxRows} rows.`);
  }
  const cell = (cells: readonly string[], index: number) =>
    index === -1 ? "" : stripFormulaGuard((cells[index] ?? "").trim());
  const nameIndex = columnOf(keys, headers.name);
  const firstIndex = columnOf(keys, headers.firstName);
  const lastIndex = columnOf(keys, headers.lastName);
  const roleIndex = columnOf(keys, headers.role);
  const statusIndex = columnOf(keys, headers.status);
  const rows: CsvMemberRow[] = [];
  const owners: CsvOwnerRow[] = [];
  const leftOut: CsvLeftOutRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  body.forEach((cells, offset) => {
    const line = offset + 2;
    const values = Object.fromEntries(names.map((name, index) => [name, cells[index] ?? ""]));
    const fail = (email: string, message: string) => {
      errors.push({ line, email, message, values });
    };
    const rawEmail = (cells[emailIndex] ?? "").trim();
    const email = rawEmail.toLowerCase();
    if (!emailSchema.safeParse(email).success) {
      fail(rawEmail, "This is not a valid email address.");
      return;
    }
    if (seen.has(email)) {
      fail(email, "This email appears earlier in the file.");
      return;
    }
    const name =
      cell(cells, nameIndex) ||
      [cell(cells, firstIndex), cell(cells, lastIndex)].filter(Boolean).join(" ");
    if (name.length > nameMaxLength) {
      fail(email, `Names can be up to ${nameMaxLength} characters.`);
      return;
    }
    seen.add(email);
    const status = cell(cells, statusIndex).toLowerCase();
    if (status !== "" && status !== "active") {
      leftOut.push({
        line,
        email,
        name: name === "" ? null : name,
        message: `The status in the file is ${status.slice(0, 40)}, so this row is left out.`,
      });
      return;
    }
    const rawRole = cell(cells, roleIndex).toLowerCase();
    if (rawRole === "owner") {
      owners.push({ line, email, name: name === "" ? null : name });
      return;
    }
    const role = rawRole === "" ? "member" : membersCsvRoles.find((value) => value === rawRole);
    if (!role) {
      seen.delete(email);
      fail(email, "Use member, moderator, or admin as the role.");
      return;
    }
    rows.push({ line, email, name: name === "" ? null : name, role });
  });
  return { rows, owners, leftOut, errors, emailColumn };
}
