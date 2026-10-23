import type { Actor, CommunityRole } from "@cohory/authz";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  withCommunity,
  type CommunityId,
} from "@cohory/db";
import { users } from "@cohory/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApprovalNoticeReader, createApprovalNotifier } from "./approvals";
import { createNotificationsService } from "./service";

const pool = createPool(parseAdminDatabaseEnv().DATABASE_ADMIN_URL);
const db = createDb(pool);
const notify = createApprovalNotifier({ db });
const inApp = createNotificationsService({ db });
const markRead = createApprovalNoticeReader({ db });

type UserActor = Actor & { kind: "user" };

let communityId: CommunityId;
let slug = "";

async function member(role: CommunityRole): Promise<UserActor> {
  const [row] = await db
    .insert(users)
    .values({
      name: `Person ${role}`,
      email: `approval-notify-${newId()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("no user");
  await addMembership(withCommunity(db, communityId), {
    userId: row.id,
    role,
    status: "active",
    joinedAt: new Date(),
  });
  return { kind: "user", userId: row.id, platformAdmin: false };
}

beforeAll(async () => {
  slug = `approval-notify-${newId().slice(-10)}`;
  const community = await createCommunity(db, {
    slug: communitySlugSchema.parse(slug),
    name: "Approval notices",
  });
  communityId = community.id;
});

afterAll(async () => {
  await pool.end();
});

describe("approval notifier", () => {
  it("tells the owning person, owners, and admins, but not moderators or members", async () => {
    const owner = await member("owner");
    const admin = await member("admin");
    const moderator = await member("moderator");
    const agentOwner = await member("member");
    const approvalId = newId();

    const inserted = await notify({
      communityId,
      approvalId,
      ownerUserId: agentOwner.userId,
      detail: "Helper asks to remove Sam Lee from the community",
    });

    expect(inserted).toBe(3);
    for (const person of [owner, admin, agentOwner]) {
      const page = await inApp.listNotifications(person);
      const notice = page.data.find((n) => n.subjectId === approvalId);
      expect(notice).toMatchObject({
        type: "approval_request",
        text: "Helper asks to remove Sam Lee from the community",
        href: `/c/${slug}/manage/inbox?tab=approvals`,
      });
    }
    const quiet = await inApp.listNotifications(moderator);
    expect(quiet.data.some((n) => n.subjectId === approvalId)).toBe(false);
  });
});

describe("approval notice reader", () => {
  it("marks the decider's notice for that request read and leaves others alone", async () => {
    const decider = await member("admin");
    const otherAdmin = await member("admin");
    const agentOwner = await member("member");
    const decided = newId();
    const other = newId();
    for (const approvalId of [decided, other]) {
      await notify({ communityId, approvalId, ownerUserId: agentOwner.userId, detail: "Asks" });
    }

    await markRead({ communityId, approvalId: decided, userId: decider.userId });

    const unread = async (person: UserActor, approvalId: string) =>
      (await inApp.listNotifications(person)).data.find((n) => n.subjectId === approvalId)
        ?.readAt ?? null;
    expect(await unread(decider, decided)).not.toBeNull();
    expect(await unread(decider, other)).toBeNull();
    expect(await unread(otherAdmin, decided)).toBeNull();
  });
});
