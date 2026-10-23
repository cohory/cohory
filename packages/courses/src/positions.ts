import { ReorderMismatchError } from "./errors";

export const positionGap = 1024;

export interface Positioned {
  readonly id: string;
  readonly position: number;
}

export function appendPosition(last: number | null): number {
  return (last ?? 0) + positionGap;
}

function longestIncreasingIndices(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = Array.from({ length: values.length }, () => -1);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((values[tails[mid] ?? 0] ?? 0) < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    previous[i] = low > 0 ? (tails[low - 1] ?? -1) : -1;
    tails[low] = i;
  }
  const kept = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index] ?? -1) {
    kept.add(index);
  }
  return kept;
}

function compact(ordered: readonly Positioned[]): Positioned[] {
  return ordered
    .map((row, index) => ({ id: row.id, position: (index + 1) * positionGap }))
    .filter((row, index) => ordered[index]?.position !== row.position);
}

export function planReorder(
  current: readonly Positioned[],
  orderedIds: readonly string[],
): Positioned[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  if (orderedIds.length !== current.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new ReorderMismatchError();
  }
  const ordered = orderedIds.map((id) => {
    const row = byId.get(id);
    if (!row) {
      throw new ReorderMismatchError();
    }
    return row;
  });
  const kept = longestIncreasingIndices(ordered.map((row) => row.position));
  const updates: Positioned[] = [];
  let lower = 0;
  let index = 0;
  while (index < ordered.length) {
    if (kept.has(index)) {
      lower = ordered[index]?.position ?? lower;
      index += 1;
      continue;
    }
    let end = index;
    while (end < ordered.length && !kept.has(end)) {
      end += 1;
    }
    const upper = ordered[end]?.position;
    const count = end - index;
    if (upper !== undefined && upper - lower - 1 < count) {
      return compact(ordered);
    }
    for (let k = 1; k <= count; k += 1) {
      const row = ordered[index + k - 1];
      if (!row) {
        continue;
      }
      const position =
        upper === undefined
          ? lower + k * positionGap
          : lower + Math.floor(((upper - lower) * k) / (count + 1));
      updates.push({ id: row.id, position });
    }
    lower = updates.at(-1)?.position ?? lower;
    index = end;
  }
  return updates;
}
