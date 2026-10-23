import { Ajv2020 } from "ajv/dist/2020.js";

export const maxJsonDocumentBytes = 32 * 1024;
export const maxJsonDepth = 32;
export const jsonSchemaDialect = "https://json-schema.org/draft/2020-12/schema";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > maxJsonDepth) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => isJsonValue(item, depth + 1));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

function depthOf(value: unknown, depth = 0): number {
  if (depth > maxJsonDepth || typeof value !== "object" || value === null) return depth;
  let deepest = depth;
  for (const item of Array.isArray(value) ? (value as unknown[]) : Object.values(value)) {
    deepest = Math.max(deepest, depthOf(item, depth + 1));
    if (deepest > maxJsonDepth) break;
  }
  return deepest;
}

function externalRef(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = externalRef(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  for (const [key, item] of Object.entries(value)) {
    if ((key === "$ref" || key === "$dynamicRef") && typeof item === "string") {
      if (!item.startsWith("#")) return item;
    }
    if (key === "$id" && typeof item === "string" && /^[a-z][a-z0-9+.-]*:/i.test(item)) {
      return item;
    }
    const found = externalRef(item);
    if (found) return found;
  }
  return null;
}

export function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

export function checkJsonDocument(value: unknown): string | null {
  if (depthOf(value) > maxJsonDepth) {
    return `Nest this at most ${maxJsonDepth} levels deep.`;
  }
  if (!isJsonValue(value)) {
    return "Use plain JSON values only.";
  }
  if (jsonSize(value) > maxJsonDocumentBytes) {
    return `Keep this under ${maxJsonDocumentBytes / 1024} KB.`;
  }
  return null;
}

export function jsonSchemaProblem(schema: unknown): string | null {
  if (typeof schema !== "boolean" && (typeof schema !== "object" || schema === null)) {
    return "A JSON Schema is an object, or true or false.";
  }
  if (Array.isArray(schema)) {
    return "A JSON Schema is an object, not a list.";
  }
  const size = checkJsonDocument(schema);
  if (size) return size;
  if (typeof schema === "object" && "$schema" in schema && schema.$schema !== jsonSchemaDialect) {
    return `Use JSON Schema 2020-12 ("$schema": "${jsonSchemaDialect}") or leave "$schema" out.`;
  }
  const ref = externalRef(schema);
  if (ref) {
    return `Refer only to definitions inside this schema. "${ref.slice(0, 80)}" points elsewhere.`;
  }
  if (!ajv.validateSchema(schema)) {
    const error = ajv.errors?.[0];
    const where = error?.instancePath ? ` at ${error.instancePath}` : "";
    return `This is not a valid JSON Schema${where}: ${error?.message ?? "unknown problem"}.`;
  }
  return null;
}

export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
