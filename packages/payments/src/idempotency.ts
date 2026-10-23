import { createHash } from "node:crypto";

export function requestKey(base: string, params: Readonly<Record<string, unknown>>): string {
  const digest = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 16);
  return `${base}:${digest}`;
}
