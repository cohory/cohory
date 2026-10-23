import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ImporterId } from "./catalog";
import type { ImportFile } from "./types";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixtureFiles(importer: ImporterId | "circle-api"): ImportFile[] {
  const folder = path.join(root, importer);
  return readdirSync(folder)
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(path.join(folder, name))) }));
}
