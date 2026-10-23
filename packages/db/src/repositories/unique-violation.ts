function causeOf(error: unknown): unknown {
  return error instanceof Error && "cause" in error ? error.cause : undefined;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (const candidate of [error, causeOf(error)]) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "code" in candidate &&
      candidate.code === "23505" &&
      "constraint" in candidate &&
      candidate.constraint === constraint
    ) {
      return true;
    }
  }
  return false;
}
