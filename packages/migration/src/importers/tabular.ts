import { MigrationError } from "../errors";
import { normalizeKey, parseCsv } from "../csv/parse";
import type { ImportFile } from "./types";

export { normalizeKey };

const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeText(file: ImportFile): string {
  try {
    return decoder.decode(file.bytes);
  } catch {
    throw new MigrationError("invalid_csv", `${file.name} is not UTF-8 text. Save it as UTF-8.`);
  }
}

function stripFormulaGuard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

export class CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  private readonly index: ReadonlyMap<string, number>;

  constructor(
    readonly file: string,
    text: string,
  ) {
    const [header = [], ...rows] = parseCsv(text);
    this.header = header.map((cell) => cell.trim());
    this.rows = rows;
    const index = new Map<string, number>();
    this.header.forEach((name, position) => {
      const key = normalizeKey(name);
      if (key && !index.has(key)) index.set(key, position);
    });
    this.index = index;
  }

  has(aliases: readonly string[]): boolean {
    return aliases.some((alias) => this.index.has(normalizeKey(alias)));
  }

  get(row: readonly string[], aliases: readonly string[]): string | null {
    for (const alias of aliases) {
      const position = this.index.get(normalizeKey(alias));
      if (position === undefined) continue;
      const value = stripFormulaGuard((row[position] ?? "").trim());
      if (value !== "") return value;
    }
    return null;
  }

  record(row: readonly string[]): Record<string, string> {
    return Object.fromEntries(this.header.map((name, position) => [name, row[position] ?? ""]));
  }

  dateOrder(aliases: readonly string[]): DateOrder | null {
    return detectDateOrder(this.rows.map((row) => this.get(row, aliases)));
  }

  unknownColumns(known: readonly (readonly string[])[], patterns: readonly RegExp[] = []) {
    const knownKeys = new Set(known.flat().map(normalizeKey));
    return this.header.filter((name) => {
      const key = normalizeKey(name);
      return key !== "" && !knownKeys.has(key) && !patterns.some((pattern) => pattern.test(key));
    });
  }
}

export function csvHeaderKeys(file: ImportFile): ReadonlySet<string> | null {
  if (!file.name.toLowerCase().endsWith(".csv")) return null;
  let text: string;
  try {
    text = decoder.decode(file.bytes.subarray(0, 8192));
  } catch {
    try {
      text = new TextDecoder("utf-8").decode(file.bytes.subarray(0, 8192));
    } catch {
      return null;
    }
  }
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  return new Set(firstLine.split(",").map((cell) => normalizeKey(cell.replaceAll('"', ""))));
}

export function hasAll(keys: ReadonlySet<string>, names: readonly string[]): boolean {
  return names.every((name) => keys.has(normalizeKey(name)));
}

export function hasAny(keys: ReadonlySet<string>, names: readonly string[]): boolean {
  return names.some((name) => keys.has(normalizeKey(name)));
}

export function readJson(file: ImportFile): unknown {
  try {
    return JSON.parse(decodeText(file)) as unknown;
  } catch (error: unknown) {
    if (error instanceof MigrationError) throw error;
    const line = error instanceof Error ? /\(line (\d+) /.exec(error.message)?.[1] : undefined;
    throw new MigrationError(
      "invalid_csv",
      `${file.name} is not valid JSON${line ? ` at line ${line}` : ""}.`,
    );
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pick(record: Record<string, unknown>, aliases: readonly string[]): unknown {
  const wanted = aliases.map(normalizeKey);
  for (const key of wanted) {
    for (const [name, value] of Object.entries(record)) {
      if (normalizeKey(name) === key && value !== null && value !== undefined && value !== "") {
        return value;
      }
    }
  }
  return undefined;
}

export function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function jsonArray(value: unknown, keys: readonly string[]): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return null;
  const nested = pick(value, keys);
  return Array.isArray(nested) ? nested : null;
}

const naiveDateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/;
const slashDate =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
const minYear = 2000;
const maxYear = 2100;

export type DateOrder = "dmy" | "mdy";

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function validParts(parts: DateParts): boolean {
  const { year, month, day, hour, minute, second } = parts;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inRange(date: Date): Date | null {
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= minYear && year <= maxYear ? date : null;
}

function fromParts(parts: DateParts): Date | null {
  if (!validParts(parts)) return null;
  const { year, month, day, hour, minute, second } = parts;
  return inRange(new Date(Date.UTC(year, month - 1, day, hour, minute, second)));
}

export function detectDateOrder(values: readonly (string | null)[]): DateOrder | null {
  let seen = false;
  for (const value of values) {
    const match = value ? slashDate.exec(value.trim()) : null;
    if (!match) continue;
    seen = true;
    if (Number(match[1]) > 12) return "dmy";
  }
  return seen ? "mdy" : null;
}

export function parseDate(value: unknown, order: DateOrder = "mdy"): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return inRange(new Date(value > 1e12 ? value : value * 1000));
  }
  const text = asText(value);
  if (!text) return null;
  const naive = naiveDateTime.exec(text);
  if (naive) {
    const [, y, mo, d, h, mi, s] = naive;
    return fromParts({
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: Number(h),
      minute: Number(mi),
      second: Number(s ?? 0),
    });
  }
  const slash = slashDate.exec(text);
  if (slash) {
    const [, first, second, y, h, mi, s, meridiem] = slash;
    const hour = Number(h ?? 0);
    if (meridiem && (hour < 1 || hour > 12)) return null;
    return fromParts({
      year: Number(y),
      month: Number(order === "dmy" ? second : first),
      day: Number(order === "dmy" ? first : second),
      hour: meridiem ? (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0) : hour,
      minute: Number(mi ?? 0),
      second: Number(s ?? 0),
    });
  }
  const iso = isoDate.exec(text);
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    const parts = {
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: Number(h ?? 0),
      minute: Number(mi ?? 0),
      second: Number(s ?? 0),
    };
    if (!validParts(parts)) return null;
    return inRange(new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text));
  }
  if (/\d{4}/.test(text)) return inRange(new Date(text));
  return null;
}

export function parseFlag(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (["yes", "true", "1", "y"].includes(normalized)) return true;
  if (["no", "false", "0", "n"].includes(normalized)) return false;
  return null;
}
