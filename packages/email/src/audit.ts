import type { EmailLog } from "./log";

const actorMaxLength = 48;

export type SuppressionChange =
  | { readonly change: "added" | "removed"; readonly addressHash: string; readonly actor: string }
  | {
      readonly change: "webhook";
      readonly addressHash: string;
      readonly batchId: string;
      readonly count: number;
    };

export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 0) {
    return "***";
  }
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return local.length > 1 ? `${local[0]}***@${domain}` : `***@${domain}`;
}

export function operatorActor(raw: string | undefined): string {
  const actor = (raw ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, actorMaxLength);
  return actor === "" ? "unknown" : actor;
}

export function recordSuppressionChange(log: EmailLog, entry: SuppressionChange): Promise<void> {
  const detail =
    entry.change === "webhook"
      ? `batch=${entry.batchId};n=${entry.count}`
      : `operator=${operatorActor(entry.actor)}`;
  return log.record({
    template: `suppression-${entry.change}`,
    recipientHash: entry.addressHash,
    status: "suppressed",
    errorCode: detail,
  });
}
