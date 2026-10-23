import { z } from "zod";

export interface AccountsCommand {
  readonly command: "mark-verified";
  readonly createdBefore: Date;
  readonly apply: boolean;
}

const argsSchema = z.union([
  z.tuple([
    z.literal("mark-verified"),
    z.literal("--created-before"),
    z.iso.datetime({ offset: true }),
  ]),
  z.tuple([
    z.literal("mark-verified"),
    z.literal("--created-before"),
    z.iso.datetime({ offset: true }),
    z.enum(["--dry-run", "--yes"]),
  ]),
]);

export function parseAccountsCommand(
  argv: readonly string[],
  now: Date = new Date(),
): AccountsCommand | null {
  const parsed = argsSchema.safeParse(argv);
  if (!parsed.success) {
    return null;
  }
  const createdBefore = new Date(parsed.data[2]);
  if (createdBefore > now) {
    return null;
  }
  return { command: "mark-verified", createdBefore, apply: parsed.data[3] === "--yes" };
}
