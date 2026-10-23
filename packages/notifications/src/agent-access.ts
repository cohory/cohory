import {
  getDb,
  newId,
  parseCommunityId,
  runInCommunity,
  withCommunity,
  type Database,
} from "@cohory/db";
import { notifications } from "@cohory/db/schema";

export interface AgentAccessNotice {
  readonly communityId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly subjectType: "course_delegation" | "approval_request";
  readonly subjectId: string;
  readonly detail: string;
}

export type AgentAccessNotifier = (notice: AgentAccessNotice) => Promise<number>;

export interface AgentAccessNotifierDeps {
  readonly db: Database;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const maxDetail = 300;

export function createAgentAccessNotifier(deps: AgentAccessNotifierDeps): AgentAccessNotifier {
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? newId;
  return (notice) =>
    runInCommunity(withCommunity(deps.db, parseCommunityId(notice.communityId)), async (q) => {
      const detail =
        notice.detail.length > maxDetail
          ? `${notice.detail.slice(0, maxDetail - 1)}…`
          : notice.detail;
      const result = await q.tx
        .insert(notifications)
        .values(
          q.values({
            id: makeId(),
            userId: notice.userId,
            actorId: notice.actorId,
            type: "agent_access" as const,
            subjectType: notice.subjectType,
            subjectId: notice.subjectId,
            postId: null,
            detail,
            createdAt: now(),
          }),
        )
        .onConflictDoNothing();
      return result.rowCount ?? 0;
    });
}

let defaultNotifier: AgentAccessNotifier | undefined;

export function getAgentAccessNotifier(): AgentAccessNotifier {
  defaultNotifier ??= createAgentAccessNotifier({ db: getDb() });
  return defaultNotifier;
}
