import type { CommunityRecord, PaymentsStore } from "../../repository";
import type { ExitRunRecord, ExitSubscription } from "../store";

export interface ExitTargetResult {
  readonly subscription: ExitSubscription;
  readonly endsAt: Date | null;
}

export interface ExitRunFinish {
  readonly run: ExitRunRecord;
  readonly status: "done" | "failed";
  readonly community: CommunityRecord;
  readonly actorId: string;
  readonly completed: readonly ExitTargetResult[];
  readonly leftRunning: readonly ExitSubscription[];
  readonly store: PaymentsStore;
  readonly now: Date;
}

export type ExitKindHook = (finish: ExitRunFinish) => Promise<void>;
