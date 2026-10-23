export async function first<T>(rows: Promise<T[]>): Promise<T | null> {
  return (await rows)[0] ?? null;
}

export async function required<T>(rows: Promise<T[]>): Promise<T> {
  const row = (await rows)[0];
  if (!row) {
    throw new Error("write returned no row");
  }
  return row;
}
