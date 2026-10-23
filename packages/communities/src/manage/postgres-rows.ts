export function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export function required<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error("write returned no row");
  }
  return row;
}

export async function countOf(rows: Promise<{ value: number }[]>): Promise<number> {
  return (await rows)[0]?.value ?? 0;
}
