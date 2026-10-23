import { PostValidationError } from "../errors";
import { maxScheduleAheadMs, minScheduleLeadMs } from "../schemas";

export function assertScheduleTime(scheduledAt: Date, now: Date): void {
  const ahead = scheduledAt.getTime() - now.getTime();
  if (ahead < minScheduleLeadMs) {
    throw new PostValidationError([
      { path: "scheduledAt", message: "Pick a time at least a minute from now." },
    ]);
  }
  if (ahead > maxScheduleAheadMs) {
    throw new PostValidationError([
      { path: "scheduledAt", message: "Pick a time within the next year." },
    ]);
  }
}
