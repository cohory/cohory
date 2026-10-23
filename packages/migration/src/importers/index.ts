import { importerIds, type ImporterId } from "./catalog";
import { circleImporter } from "./circle";
import { skoolImporter } from "./skool";
import type { DetectedFile, Importer, ImportFile } from "./types";

export const importers: Readonly<Record<ImporterId, Importer>> = {
  skool: skoolImporter,
  circle: circleImporter,
};

export function getImporter(id: ImporterId): Importer {
  return importers[id];
}

export interface SourceGuess {
  readonly importer: ImporterId | null;
  readonly files: readonly DetectedFile[];
}

export function detectSource(files: readonly ImportFile[]): SourceGuess {
  let best: SourceGuess = { importer: null, files: [] };
  let bestScore = 0;
  for (const id of importerIds) {
    const detected = files.map((file) => importers[id].detect(file));
    const score = detected.filter((file) => file.kind !== null).length;
    if (score > bestScore) {
      best = { importer: id, files: detected };
      bestScore = score;
    }
  }
  return best;
}

export * from "./catalog";
export type * from "./types";
