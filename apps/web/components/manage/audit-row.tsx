import type { AuditEntryView } from "@cohory/communities";
import { AgentBadge } from "@cohory/ui";
import Link from "next/link";

import { auditDetails, auditWho, type AuditTarget } from "../../lib/manage/audit";

export function AuditWhoCell({ entry }: { entry: AuditEntryView }) {
  const who = auditWho(entry);
  switch (who.kind) {
    case "decision":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{who.person}</span>
          <span className="text-text-muted">{who.verb} a request from</span>
          <span>{who.agent}</span>
          <AgentBadge name={who.agent} />
        </span>
      );
    case "on_request":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{who.person}</span>
          <span className="text-text-muted">on a request from</span>
          <span>{who.agent}</span>
          <AgentBadge name={who.agent} />
        </span>
      );
    case "agent":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <span>{who.agent}</span>
          <AgentBadge name={who.agent} />
          <span className="text-text-muted">for {who.owner}</span>
        </span>
      );
    case "person":
      return <span>{who.name}</span>;
    case "system":
      return <span>System</span>;
  }
}

export function AuditTargetCell({ target }: { target: AuditTarget }) {
  if (!target.href) {
    return <span>{target.label}</span>;
  }
  return (
    <Link
      href={target.href}
      className="rounded-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {target.label}
    </Link>
  );
}

export function AuditDetails({ entry }: { entry: AuditEntryView }) {
  const details = auditDetails(entry.metadata);
  const technical = [
    ...(entry.target ? [{ label: "Target", value: entry.target }] : []),
    ...(entry.tokenId ? [{ label: "Token id", value: entry.tokenId }] : []),
  ];
  const rows = [...details, ...technical];
  if (rows.length === 0) {
    return null;
  }
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Details
      </summary>
      <dl className="mt-2 flex flex-col gap-2 rounded-md bg-surface-raised p-3">
        {rows.map((row, index) => (
          <div key={`${row.label}-${index}`} className="flex flex-col gap-0.5">
            <dt className="text-xs text-text-muted">{row.label}</dt>
            <dd className="font-mono text-xs break-all whitespace-pre-wrap text-text">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
