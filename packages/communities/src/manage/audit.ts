import { assertCan, ForbiddenError, type Actor } from "@cohory/authz";
import { z } from "zod";

import { CommunityValidationError } from "../errors";
import { inManagedCommunity, parseInput, type Runtime } from "./context";
import { csvBom, csvRow } from "./csv";
import type { AuditCursor, AuditFilter, AuditRow } from "./repository";

export const auditPageSize = 50;
export const auditCsvMaxRows = 10_000;
export const auditCsvColumns = [
  "created_at",
  "actor",
  "actor_id",
  "actor_type",
  "via",
  "token_id",
  "agent_id",
  "agent_name",
  "action",
  "target",
  "target_name",
  "metadata",
] as const;

const day = z.iso.date({ error: "Use a date like 2026-10-18." });

export const auditActorTypes = ["user", "agent", "system"] as const;
export const auditVias = ["web", "api", "mcp", "job"] as const;

export type AuditActorTypeFilter = (typeof auditActorTypes)[number];
export type AuditViaFilter = (typeof auditVias)[number];

export const listAuditLogInputSchema = z.strictObject({
  action: z
    .string()
    .trim()
    .regex(/^[a-z_]+(\.[a-z_]+)*$/, { error: "Choose an action from the list." })
    .max(64)
    .optional(),
  actorType: z.enum(auditActorTypes, { error: "Choose who acted from the list." }).optional(),
  via: z.enum(auditVias, { error: "Choose how it was done from the list." }).optional(),
  agentId: z.uuid({ error: "Choose an agent from the list." }).optional(),
  tokenId: z.uuid({ error: "Choose a token from the list." }).optional(),
  excludeActions: z
    .array(
      z
        .string()
        .regex(/^[a-z_]+(\.[a-z_]+)*$/)
        .max(64),
    )
    .max(20)
    .optional(),
  from: day.optional(),
  to: day.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type ListAuditLogInput = z.input<typeof listAuditLogInputSchema>;

export const listOwnActivityInputSchema = listAuditLogInputSchema.pick({
  agentId: true,
  tokenId: true,
  cursor: true,
  limit: true,
});

export type ListOwnActivityInput = z.input<typeof listOwnActivityInputSchema>;

export interface AuditEntryView {
  readonly id: string;
  readonly createdAt: Date;
  readonly actor: { readonly id: string; readonly name: string } | null;
  readonly actorType: AuditActorTypeFilter | null;
  readonly via: AuditViaFilter | null;
  readonly tokenId: string | null;
  readonly agent: { readonly id: string; readonly name: string } | null;
  readonly action: string;
  readonly target: string | null;
  readonly targetName: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

export interface AuditLogPage {
  readonly data: readonly AuditEntryView[];
  readonly nextCursor: string | null;
  readonly actions: readonly string[];
}

export interface AuditCsvExport {
  readonly filename: string;
  readonly body: string;
  readonly truncated: boolean;
}

const cursorSchema = z.strictObject({ c: z.iso.datetime(), i: z.uuid() });

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString(
    "base64url",
  );
}

export function decodeAuditCursor(raw: string): AuditCursor {
  let json: unknown = null;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    json = null;
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) {
    throw new CommunityValidationError([{ path: "cursor", message: "The cursor is not valid." }]);
  }
  return { createdAt: new Date(parsed.data.c), id: parsed.data.i };
}

const dayMs = 24 * 60 * 60 * 1000;

function toFilter(input: z.output<typeof listAuditLogInputSchema>): Omit<AuditFilter, "limit"> {
  const from = input.from ? new Date(`${input.from}T00:00:00.000Z`) : null;
  const before = input.to
    ? new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + dayMs)
    : null;
  if (from && before && from >= before) {
    throw new CommunityValidationError([
      { path: "to", message: "The end date must be on or after the start date." },
    ]);
  }
  return {
    action: input.action ?? null,
    actorType: input.actorType ?? null,
    via: input.via ?? null,
    agentId: input.agentId ?? null,
    tokenId: input.tokenId ?? null,
    excludeActions: input.excludeActions ?? [],
    credentialActorId: null,
    from,
    before,
    cursor: input.cursor ? decodeAuditCursor(input.cursor) : null,
  };
}

function toView(row: AuditRow): AuditEntryView {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actor: row.actorId ? { id: row.actorId, name: row.actorName ?? "Former member" } : null,
    actorType: row.actorType,
    via: row.via,
    tokenId: row.tokenId,
    agent: row.agentId ? { id: row.agentId, name: row.agentName ?? "Removed agent" } : null,
    action: row.action,
    target: row.target,
    targetName: row.targetName,
    metadata: row.metadata,
  };
}

export function auditCsvRow(entry: AuditEntryView): string {
  return csvRow([
    entry.createdAt.toISOString(),
    entry.actor?.name ?? null,
    entry.actor?.id ?? null,
    entry.actorType,
    entry.via,
    entry.tokenId,
    entry.agent?.id ?? null,
    entry.agent?.name ?? null,
    entry.action,
    entry.target,
    entry.targetName,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
  ]);
}

export function auditOperations(runtime: Runtime) {
  return {
    async listAuditLog(
      actor: Actor,
      communityId: string,
      input: ListAuditLogInput = {},
    ): Promise<AuditLogPage> {
      const parsed = parseInput(listAuditLogInputSchema, input);
      const limit = parsed.limit ?? auditPageSize;
      const filter = toFilter(parsed);
      return inManagedCommunity(runtime, actor, communityId, async ({ context, store }) => {
        assertCan(actor, "read", "audit_log", context);
        await store.enableManagement();
        const [rows, actions] = await Promise.all([
          store.listAudit({ ...filter, limit: limit + 1 }),
          store.listAuditActions(),
        ]);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          data: page.map(toView),
          nextCursor:
            rows.length > limit && last
              ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
              : null,
          actions,
        };
      });
    },

    async listOwnActivity(
      actor: Actor,
      communityId: string,
      input: ListOwnActivityInput = {},
    ): Promise<AuditLogPage> {
      const parsed = parseInput(listOwnActivityInputSchema, input);
      const limit = parsed.limit ?? auditPageSize;
      const filter = toFilter(parsed);
      return inManagedCommunity(runtime, actor, communityId, async ({ user, role, store }) => {
        if (user.credential || role === null) {
          throw new ForbiddenError("read_own", "audit_log");
        }
        await store.enableManagement();
        const rows = await store.listAudit({
          ...filter,
          credentialActorId: user.userId,
          limit: limit + 1,
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          data: page.map(toView),
          nextCursor:
            rows.length > limit && last
              ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
              : null,
          actions: [],
        };
      });
    },

    async exportAuditLogCsv(
      actor: Actor,
      communityId: string,
      input: Omit<ListAuditLogInput, "cursor" | "limit"> = {},
    ): Promise<AuditCsvExport> {
      const filter = toFilter(parseInput(listAuditLogInputSchema, input));
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "export", "audit_log", managed.context);
        await managed.store.enableManagement();
        const rows = await managed.store.listAudit({
          ...filter,
          cursor: null,
          limit: auditCsvMaxRows + 1,
        });
        const kept = rows.slice(0, auditCsvMaxRows);
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "export.audit_log_csv",
          target: managed.community.id,
          metadata: {
            rows: kept.length,
            action: filter.action,
            actorType: filter.actorType,
            via: filter.via,
            agentId: filter.agentId,
            tokenId: filter.tokenId,
            from: input.from ?? null,
            to: input.to ?? null,
          },
        });
        return {
          filename: `${managed.community.slug}-audit-log-${runtime.now().toISOString().slice(0, 10)}.csv`,
          body:
            csvBom + csvRow(auditCsvColumns) + kept.map((row) => auditCsvRow(toView(row))).join(""),
          truncated: rows.length > auditCsvMaxRows,
        };
      });
    },
  };
}
