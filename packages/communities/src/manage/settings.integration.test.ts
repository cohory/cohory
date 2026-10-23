import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { newId, parseCommunityId, type CommunityId } from "@cohory/db";
import {
  comments,
  communities,
  courses,
  eventOccurrences,
  events,
  inviteLinks,
  memberships,
  outbox,
  payments,
  posts,
} from "@cohory/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommunityArchivedError,
  CommunityDeletionConflictError,
  CommunityNotArchivedError,
  CommunityNotFoundError,
  CommunityValidationError,
  MembershipNotFoundError,
} from "../errors";
import { createPostgresCommunitiesRepository } from "../postgres-repository";
import { createCommunitiesService } from "../service";
import { membershipEventsTopic, type MembershipEvent } from "./events";
import { purgeCommunity } from "./purge";
import type { BeginDeletionInput, DeletionStart, PaidExitPort } from "./paid-exit";
import {
  auditActions,
  insertCast,
  insertMember,
  openManageHarness,
  unpaidExit,
  type Cast,
  type ManageHarness,
} from "../test/manage-fixtures";

let h: ManageHarness;

beforeAll(async () => {
  h = await openManageHarness();
});

afterAll(async () => {
  await h.close();
});

const nineNames = ["Seed", "Sprout", "Leaf", "Stem", "Bud", "Bloom", "Fruit", "Tree", "Forest"];

describe("updateSettings", () => {
  let cast: Cast;

  beforeAll(async () => {
    cast = await insertCast(h.admin);
  });

  it("lets the owner change name, privacy, gamification, and level names and audits it", async () => {
    const view = await h.service.updateSettings(cast.owner, cast.communityId, {
      name: "  Renamed  ",
      privacy: "public",
      gamificationEnabled: false,
      levelNames: nineNames,
    });

    expect(view).toMatchObject({
      name: "Renamed",
      privacy: "public",
      gamificationEnabled: false,
      levelNames: nineNames,
    });
    expect(await auditActions(h.admin, cast.communityId)).toContain("settings.updated");
  });

  it("saves the creator's refund line, trims it, and clears it", async () => {
    const saved = await h.service.updateSettings(cast.owner, cast.communityId, {
      refundPolicy: "  Full refund within 14 days. Email me.  ",
    });
    expect(saved.refundPolicy).toBe("Full refund within 14 days. Email me.");

    const cleared = await h.service.updateSettings(cast.owner, cast.communityId, {
      refundPolicy: null,
    });
    expect(cleared.refundPolicy).toBeNull();
  });

  it("refuses a refund line longer than 280 characters", async () => {
    await expect(
      h.service.updateSettings(cast.owner, cast.communityId, { refundPolicy: "x".repeat(281) }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("saves approval as open joining while a plan is on sale", async () => {
    const paid = await insertCast(h.admin);
    await h.admin
      .update(communities)
      .set({ currency: "usd" })
      .where(eq(communities.id, paid.communityId));

    const view = await h.service.updateSettings(paid.owner, paid.communityId, {
      joinMode: "approval",
    });

    expect(view.joinMode).toBe("open");
    const [row] = await h.admin
      .select({ joinMode: communities.joinMode })
      .from(communities)
      .where(eq(communities.id, paid.communityId));
    expect(row).toEqual({ joinMode: "open" });
  });

  it("keeps invite only and approval for a free community", async () => {
    const free = await insertCast(h.admin);

    const invite = await h.service.updateSettings(free.owner, free.communityId, {
      joinMode: "invite",
    });
    const approval = await h.service.updateSettings(free.owner, free.communityId, {
      joinMode: "approval",
    });

    expect(invite.joinMode).toBe("invite");
    expect(approval.joinMode).toBe("approval");
  });

  it("lets an admin use the named helpers", async () => {
    await h.service.updateGeneral(cast.admin, cast.communityId, { description: "About us" });
    await h.service.setGamificationEnabled(cast.admin, cast.communityId, true);
    const view = await h.service.updateLevelNames(cast.admin, cast.communityId, nineNames);

    expect(view.description).toBe("About us");
    expect(view.gamificationEnabled).toBe(true);
  });

  it("keeps learning points off until the creator turns them on, and audits the change", async () => {
    const fresh = await insertCast(h.admin);
    const before = await h.service.getSettings(fresh.owner, fresh.communityId);
    expect(before).toMatchObject({ pointsForLessons: false, pointsForEvents: false });

    const view = await h.service.updateSettings(fresh.admin, fresh.communityId, {
      pointsForLessons: true,
      pointsForEvents: true,
    });

    expect(view).toMatchObject({ pointsForLessons: true, pointsForEvents: true });
    const [row] = await h.admin
      .select({
        pointsForLessons: communities.pointsForLessons,
        pointsForEvents: communities.pointsForEvents,
      })
      .from(communities)
      .where(eq(communities.id, fresh.communityId));
    expect(row).toEqual({ pointsForLessons: true, pointsForEvents: true });
    expect(await auditActions(h.admin, fresh.communityId)).toContain("settings.updated");
  });

  it("keeps the stored learning point switches when a save leaves them out", async () => {
    const fresh = await insertCast(h.admin);
    await h.service.updateSettings(fresh.owner, fresh.communityId, {
      pointsForLessons: true,
      pointsForEvents: true,
    });

    await h.service.updateSettings(fresh.owner, fresh.communityId, { gamificationEnabled: true });
    const view = await h.service.updateSettings(fresh.owner, fresh.communityId, {
      gamificationEnabled: false,
      pointsForLessons: undefined,
      pointsForEvents: undefined,
    });

    expect(view).toMatchObject({ pointsForLessons: true, pointsForEvents: true });
  });

  it.each(["moderator", "member"] as const)(
    "refuses a %s who turns on learning points",
    async (role) => {
      await expect(
        h.service.updateSettings(cast[role], cast.communityId, { pointsForLessons: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        h.service.updateSettings(cast[role], cast.communityId, { pointsForEvents: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it.each(["moderator", "member"] as const)("refuses a %s", async (role) => {
    await expect(
      h.service.updateSettings(cast[role], cast.communityId, { name: "Nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides a private community from an outsider and refuses a guest", async () => {
    const privateCast = await insertCast(h.admin, "private");
    await expect(
      h.service.updateSettings(privateCast.outsider, privateCast.communityId, { name: "x" }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    await expect(
      h.service.updateSettings({ kind: "guest" }, privateCast.communityId, { name: "x" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("refuses an outsider of a public community with 403", async () => {
    const publicCast = await insertCast(h.admin, "public");
    await expect(
      h.service.updateSettings(publicCast.outsider, publicCast.communityId, { name: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects eight level names", async () => {
    await expect(
      h.service.updateLevelNames(cast.owner, cast.communityId, nineNames.slice(0, 8)),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("does not let one community's owner change another community", async () => {
    const other = await insertCast(h.admin);
    await expect(
      h.service.updateSettings(cast.owner, other.communityId, { name: "Taken" }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });
});

describe("getOverviewStats", () => {
  it("counts only this community's recent members, posts, comments, events, and courses", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await insertMember(h.admin, cast.communityId, "member", "removed");
    const content = { body: { type: "doc" as const, content: [] }, bodyHtml: "", bodyText: "" };
    for (const target of [cast, other]) {
      const [post] = await h.admin
        .insert(posts)
        .values({
          communityId: target.communityId,
          authorId: target.member.userId,
          excerpt: "",
          ...content,
        })
        .returning();
      await h.admin.insert(posts).values({
        communityId: target.communityId,
        authorId: target.member.userId,
        excerpt: "",
        createdAt: old,
        ...content,
      });
      await h.admin.insert(comments).values({
        communityId: target.communityId,
        postId: post?.id ?? newId(),
        authorId: target.member.userId,
        ...content,
      });
    }
    const [event] = await h.admin
      .insert(events)
      .values({
        communityId: cast.communityId,
        slug: "weekly",
        title: "Weekly",
        startsAtLocal: "2030-01-01T10:00",
        timeZone: "UTC",
        durationMinutes: 60,
      })
      .returning();
    await h.admin.insert(eventOccurrences).values([
      {
        communityId: cast.communityId,
        eventId: event?.id ?? newId(),
        startsAt: new Date("2030-01-01T10:00:00Z"),
        endsAt: new Date("2030-01-01T11:00:00Z"),
      },
      {
        communityId: cast.communityId,
        eventId: event?.id ?? newId(),
        startsAt: new Date("2020-01-01T10:00:00Z"),
        endsAt: new Date("2020-01-01T11:00:00Z"),
      },
    ]);
    await h.admin.insert(courses).values([
      { communityId: cast.communityId, slug: "a", title: "A", position: 0, status: "published" },
      { communityId: cast.communityId, slug: "b", title: "B", position: 1 },
    ]);

    const stats = await h.service.getOverviewStats(cast.admin, cast.communityId);

    expect(stats).toEqual({
      memberCount: 4,
      newMembers7d: 4,
      posts7d: 1,
      comments7d: 1,
      upcomingEvents: 1,
      publishedCourses: 1,
    });
  });

  it("refuses a moderator", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.getOverviewStats(cast.moderator, cast.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("transferOwnership", () => {
  it("makes the target the owner and the old owner an admin", async () => {
    const cast = await insertCast(h.admin);

    await h.service.transferOwnership(cast.owner, cast.communityId, cast.member.userId);

    const rows = await h.admin
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.communityId, cast.communityId));
    const roleOf = (userId: string) => rows.find((row) => row.userId === userId)?.role;
    expect(roleOf(cast.member.userId)).toBe("owner");
    expect(roleOf(cast.owner.userId)).toBe("admin");
    expect(await auditActions(h.admin, cast.communityId)).toContain(
      "community.ownership_transferred",
    );
  });

  it("tells the previous and the new owner through one membership event", async () => {
    const cast = await insertCast(h.admin);

    await h.service.transferOwnership(cast.owner, cast.communityId, cast.member.userId);

    const rows = await h.admin
      .select({ payload: outbox.payload })
      .from(outbox)
      .where(
        and(eq(outbox.communityId, cast.communityId), eq(outbox.topic, membershipEventsTopic)),
      );
    const events = rows.flatMap((row) => (row.payload as { events: MembershipEvent[] }).events);
    expect(events).toEqual([
      {
        type: "ownership.transferred",
        payload: {
          communityId: cast.communityId,
          noticeId: expect.any(String),
          previousOwnerId: cast.owner.userId,
          newOwnerId: cast.member.userId,
        },
      },
    ]);
  });

  it("refuses an admin and a transfer to someone outside the community", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.transferOwnership(cast.admin, cast.communityId, cast.member.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.transferOwnership(cast.owner, cast.communityId, cast.outsider.userId),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});

describe("archive and delete", () => {
  it("keeps settings and restore working while it rejects people and appearance changes", async () => {
    const cast = await insertCast(h.admin, "public");
    await h.service.archiveCommunity(cast.owner, cast.communityId);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

    const renamed = await h.service.updateSettings(cast.owner, cast.communityId, {
      name: "Still here",
    });
    expect(renamed.name).toBe("Still here");
    expect(await h.service.listMembersForManage(cast.admin, cast.communityId)).toBeTruthy();
    const writes = [
      () => h.service.updateAppearance(cast.owner, cast.communityId, { accent: "#0f766e" }),
      () =>
        h.service.uploadBranding(cast.owner, cast.communityId, "logo", {
          bytes: png,
          declaredType: "image/png",
        }),
      () => h.service.changeRole(cast.owner, cast.communityId, cast.member.userId, "moderator"),
      () => h.service.removeMember(cast.owner, cast.communityId, cast.member.userId),
      () => h.service.banMember(cast.owner, cast.communityId, cast.member.userId),
      () => h.service.createInviteLink(cast.owner, cast.communityId),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(CommunityArchivedError);
    }

    await h.service.unarchiveCommunity(cast.owner, cast.communityId);
    const changed = await h.service.changeRole(
      cast.owner,
      cast.communityId,
      cast.member.userId,
      "moderator",
    );
    expect(changed.role).toBe("moderator");
  });

  it("archives, blocks joins, unarchives, and only deletes an archived community", async () => {
    const cast = await insertCast(h.admin, "public");
    const communitiesService = createCommunitiesService(createPostgresCommunitiesRepository(h.app));

    await expect(h.service.deleteCommunity(cast.owner, cast.communityId)).rejects.toBeInstanceOf(
      CommunityNotArchivedError,
    );
    await expect(h.service.archiveCommunity(cast.admin, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const archived = await h.service.archiveCommunity(cast.owner, cast.communityId);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(
      communitiesService.joinCommunity(cast.outsider, cast.communityId),
    ).rejects.toBeInstanceOf(CommunityArchivedError);

    const restored = await h.service.unarchiveCommunity(cast.owner, cast.communityId);
    expect(restored.archivedAt).toBeNull();
    await h.service.createInviteLink(cast.owner, cast.communityId);
    await h.service.archiveCommunity(cast.owner, cast.communityId);
    await expect(h.service.createInviteLink(cast.owner, cast.communityId)).rejects.toBeInstanceOf(
      CommunityArchivedError,
    );
    await expect(h.service.deleteCommunity(cast.admin, cast.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await h.service.deleteCommunity(cast.owner, cast.communityId);

    const id = parseCommunityId(cast.communityId);
    await expect(
      communitiesService.getCommunityBySlug(cast.owner, cast.slug),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    expect(await purgeCommunity({ db: h.app, paidExit: unpaidExit }, id)).toBe("purged");
    expect(await h.admin.select().from(communities).where(eq(communities.id, id))).toEqual([]);
    expect(await h.admin.select().from(memberships).where(eq(memberships.communityId, id))).toEqual(
      [],
    );
    expect(await h.admin.select().from(inviteLinks).where(eq(inviteLinks.communityId, id))).toEqual(
      [],
    );
  });
});

describe("deleting a community with paid members", () => {
  let paid: ManageHarness;
  let ready = true;
  let start: DeletionStart = { kind: "ready" };
  const begun: BeginDeletionInput[] = [];
  let gate: PaidExitPort["prepareDeletion"] = unpaidExit.prepareDeletion;

  beforeAll(async () => {
    paid = await openManageHarness({
      paidExit: {
        ...unpaidExit,
        beginDeletion: async (input) => {
          begun.push(input);
          return start;
        },
        deletionReady: async () => ready,
        prepareDeletion: (queries, input) => gate(queries, input),
      },
    });
  });

  afterAll(async () => {
    await paid.close();
  });

  async function archivedCast(): Promise<Cast> {
    const cast = await insertCast(paid.admin, "public");
    await paid.service.archiveCommunity(cast.owner, cast.communityId);
    ready = true;
    start = { kind: "ready" };
    begun.length = 0;
    gate = unpaidExit.prepareDeletion;
    return cast;
  }

  async function insertPayment(communityId: string): Promise<string> {
    const [row] = await paid.admin
      .insert(payments)
      .values({
        communityId,
        externalInvoiceId: `in_settings${newId()}`,
        currency: "usd",
        amountMinor: 2900,
        occurredAt: new Date("2026-09-15T00:00:00Z"),
      })
      .returning({ id: payments.id });
    return row?.id ?? "";
  }

  async function exists(communityId: string): Promise<boolean> {
    const id: CommunityId = parseCommunityId(communityId);
    return (await paid.admin.select().from(communities).where(eq(communities.id, id))).length > 0;
  }

  async function purge(communityId: string) {
    return purgeCommunity(
      { db: paid.app, paidExit: { prepareDeletion: (queries, input) => gate(queries, input) } },
      parseCommunityId(communityId),
    );
  }

  it("deletes an archived community with payment records and keeps the records", async () => {
    const cast = await archivedCast();
    const paymentId = await insertPayment(cast.communityId);

    const outcome = await paid.service.deleteCommunity(cast.owner, cast.communityId);

    expect(outcome).toEqual({ kind: "deleted" });
    expect(await purge(cast.communityId)).toBe("purged");
    expect(await exists(cast.communityId)).toBe(false);
    const [payment] = await paid.admin.select().from(payments).where(eq(payments.id, paymentId));
    expect(payment).toMatchObject({ communityId: null, formerCommunityId: cast.communityId });
  });

  it("refuses to purge with deletion_conflict when a payment record cannot be detached", async () => {
    const cast = await archivedCast();
    await insertPayment(cast.communityId);
    gate = async () => true;

    expect(await paid.service.deleteCommunity(cast.owner, cast.communityId)).toEqual({
      kind: "deleted",
    });
    await expect(purge(cast.communityId)).rejects.toBeInstanceOf(CommunityDeletionConflictError);
    expect(await exists(cast.communityId)).toBe(true);
  });

  it("passes the linked import option and manual confirmation to payments", async () => {
    const cast = await archivedCast();

    await paid.service.deleteCommunity(cast.owner, cast.communityId, {
      includeLinked: false,
      confirmedManualCancellation: true,
    });

    expect(begun).toEqual([
      {
        communityId: cast.communityId,
        actorId: cast.owner.userId,
        includeLinked: false,
        confirmedManualCancellation: true,
      },
    ]);
  });

  it("keeps the community while subscriptions are being cancelled", async () => {
    const cast = await archivedCast();
    start = { kind: "queued", runId: newId() };
    ready = false;

    const outcome = await paid.service.deleteCommunity(cast.owner, cast.communityId);

    expect(outcome).toEqual({ kind: "deleting" });
    expect(await exists(cast.communityId)).toBe(true);
  });

  it("completes a deletion only once payments says it is ready", async () => {
    const cast = await archivedCast();
    const id = parseCommunityId(cast.communityId);
    ready = false;

    expect(await paid.service.completeCommunityDeletion(id)).toBe("not_ready");
    expect(await exists(cast.communityId)).toBe(true);

    ready = true;
    expect(await paid.service.completeCommunityDeletion(id)).toBe("deleted");
    expect(await purge(cast.communityId)).toBe("purged");
    expect(await exists(cast.communityId)).toBe(false);
  });

  it("never completes the deletion of a community that is not archived", async () => {
    const cast = await insertCast(paid.admin, "public");
    ready = true;

    expect(await paid.service.completeCommunityDeletion(parseCommunityId(cast.communityId))).toBe(
      "not_ready",
    );
    expect(await exists(cast.communityId)).toBe(true);
  });
});
