import { scopeDetails, type Scope, type ScopeAccess } from "@cohory/authz";
import { Badge, RelativeTime } from "@cohory/ui";

import { viaLabels, type TokenVia } from "./format";

const accessLabels: Readonly<Record<ScopeAccess, string>> = {
  read: "Read",
  write: "Write",
  sensitive: "Sensitive",
};

const accessOrder: readonly ScopeAccess[] = ["read", "write", "sensitive"];

export function ScopeChips({ scopes }: { scopes: readonly Scope[] }) {
  const groups = accessOrder
    .map((access) => ({
      access,
      labels: scopes
        .filter((scope) => scopeDetails[scope].access === access)
        .map((scope) => scopeDetails[scope].label),
    }))
    .filter((group) => group.labels.length > 0);
  if (groups.length === 0) {
    return <span className="text-sm text-text-muted">No permissions</span>;
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {groups.map((group) => (
        <li key={group.access} className="flex flex-wrap items-baseline gap-2">
          <Badge variant={group.access === "read" ? "neutral" : "warning"}>
            {accessLabels[group.access]}
          </Badge>
          <span className="break-words text-text">{group.labels.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

export function LastUsed({ at, via }: { at: string | null; via: TokenVia | null }) {
  if (at === null) {
    return <span>Never used</span>;
  }
  return (
    <span>
      Last used <RelativeTime value={at} />
      {via ? ` ${viaLabels[via]}` : null}
    </span>
  );
}
