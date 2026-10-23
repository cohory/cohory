import type { ExitKind, ExitRunRecord, ExitStore } from "./store";

const exitKinds: readonly ExitKind[] = ["archive", "disconnect", "delete"];

export async function latestExitRun(exit: ExitStore): Promise<ExitRunRecord | null> {
  const unfinished = await exit.findUnfinishedRun();
  if (unfinished) {
    return unfinished;
  }
  let latest: ExitRunRecord | null = null;
  for (const kind of exitKinds) {
    const run = await exit.latestRun(kind);
    if (run && (!latest || run.createdAt.getTime() > latest.createdAt.getTime())) {
      latest = run;
    }
  }
  return latest;
}
