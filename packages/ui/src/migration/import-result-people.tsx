import type { ArchiveResult } from "./types";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function accountsLine(result: ArchiveResult): string {
  const parts = [
    result.createdAccounts > 0 ? plural(result.createdAccounts, "new account", "new accounts") : "",
    result.linkedAccounts > 0 ? `${result.linkedAccounts} linked by email` : "",
    (result.invitedAccounts ?? 0) > 0
      ? `${plural(result.invitedAccounts ?? 0, "person", "people")} invited`
      : "",
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(", ")}.` : "Nobody new joined.";
}

function emailLine(result: ArchiveResult): string {
  if (result.emailChoice === "later") {
    return "No emails went out yet. Send them from Import history when you are ready.";
  }
  if (result.emailChoice === "never") return "No emails went out.";
  const notSent = result.emailsNotSent ?? 0;
  const sent = result.emailsSent > 0 ? plural(result.emailsSent, "email sent", "emails sent") : "";
  const missed =
    notSent > 0 ? `${notSent} not sent because the address opted out or could not be reached` : "";
  const line = [sent, missed].filter(Boolean).join(", ");
  return line ? `${line}.` : "";
}

function overLimitLine(result: ArchiveResult): string {
  const over = result.emailsOverLimit ?? 0;
  if (over === 0) return "";
  return `${over === 1 ? "1 person" : `${over} people`} will not be emailed because your plan allows fewer members.`;
}

export function ImportResultPeople({ result }: { result: ArchiveResult }) {
  const lines = [accountsLine(result), emailLine(result), overLimitLine(result)].filter(Boolean);
  return <>{lines.join(" ")}</>;
}
