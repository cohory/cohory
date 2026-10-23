import { scopeSchema, type Scope } from "@cohory/authz";
import type { AgentStatus, ApiTokenKind, AuditVia } from "@cohory/db/schema";

export type TokenState = "active" | "expired" | "revoked";

export interface ApiTokenView {
  readonly id: string;
  readonly kind: ApiTokenKind;
  readonly communityId: string;
  readonly agentId: string | null;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly Scope[];
  readonly state: TokenState;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
  readonly lastUsedVia: AuditVia | null;
  readonly oauth: boolean;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface PersonalTokenView extends ApiTokenView {
  readonly community: { readonly slug: string; readonly name: string };
}

export interface AgentView {
  readonly id: string;
  readonly communityId: string;
  readonly name: string;
  readonly description: string | null;
  readonly scopes: readonly Scope[];
  readonly status: AgentStatus;
  readonly communityWide: boolean;
  readonly owner: { readonly id: string; readonly name: string };
  readonly lastActivityAt: Date | null;
  readonly createdAt: Date;
  readonly canManage: boolean;
  readonly canIssueTokens: boolean;
  readonly tokens: readonly ApiTokenView[];
}

export interface CreatedToken<T extends ApiTokenView = ApiTokenView> {
  readonly token: string;
  readonly view: T;
}

export function knownScopes(values: readonly string[]): Scope[] {
  return values.flatMap((value) => {
    const parsed = scopeSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface TokenRow {
  readonly id: string;
  readonly kind: ApiTokenKind;
  readonly communityId: string;
  readonly agentId: string | null;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
  readonly lastUsedVia: AuditVia | null;
  readonly oauthGrantId: string | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export function tokenState(row: Pick<TokenRow, "revokedAt" | "expiresAt">, now: Date): TokenState {
  if (row.revokedAt) {
    return "revoked";
  }
  return row.expiresAt <= now ? "expired" : "active";
}

export function toTokenView(row: TokenRow, now: Date): ApiTokenView {
  return {
    id: row.id,
    kind: row.kind,
    communityId: row.communityId,
    agentId: row.agentId,
    name: row.name,
    prefix: row.prefix,
    scopes: knownScopes(row.scopes),
    state: tokenState(row, now),
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedVia: row.lastUsedVia,
    oauth: row.oauthGrantId !== null,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
