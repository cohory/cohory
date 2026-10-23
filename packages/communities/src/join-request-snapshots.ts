import { can } from "@cohory/authz";
import {
  findMembershipIn,
  parseCommunityId,
  runInCommunity,
  setRlsFlag,
  setRlsValue,
  withCommunity,
  type Database,
} from "@cohory/db";
import { membershipRequests, type JoinAnswerJson } from "@cohory/db/schema";
import { inArray } from "drizzle-orm";

export interface JoinRequestSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly answers: readonly JoinAnswerJson[];
  readonly decisionNote: string | null;
}

export interface JoinRequestSnapshots {
  readonly readerCanApprove: boolean;
  readonly requests: ReadonlyMap<string, JoinRequestSnapshot>;
}

// For notification emails: the reader sees every listed request while their current role may
// approve requests, and otherwise only their own (an answer to their own request).
export async function getJoinRequestSnapshots(
  db: Database,
  input: {
    readonly communityId: string;
    readonly readerId: string;
    readonly requestIds: readonly string[];
  },
): Promise<JoinRequestSnapshots> {
  const scope = withCommunity(db, parseCommunityId(input.communityId));
  return runInCommunity(scope, async (queries) => {
    const { tx, where } = queries;
    const membership = await findMembershipIn(queries, input.readerId);
    const readerCanApprove =
      membership?.status === "active" &&
      can({ kind: "user", userId: input.readerId, platformAdmin: false }, "approve", "membership", {
        role: membership.role,
      });
    if (input.requestIds.length === 0) {
      return { readerCanApprove, requests: new Map() };
    }
    await setRlsValue(tx, "user_id", input.readerId);
    if (readerCanApprove) {
      await setRlsFlag(tx, "community_manager");
    }
    const rows = await tx
      .select({
        id: membershipRequests.id,
        userId: membershipRequests.userId,
        answers: membershipRequests.answers,
        decisionNote: membershipRequests.decisionNote,
      })
      .from(membershipRequests)
      .where(where(membershipRequests, inArray(membershipRequests.id, [...input.requestIds])));
    const visible = rows.filter((row) => readerCanApprove || row.userId === input.readerId);
    return { readerCanApprove, requests: new Map(visible.map((row) => [row.id, row])) };
  });
}
