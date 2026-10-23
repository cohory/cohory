import { ForbiddenError, UnauthenticatedError, type Actor } from "@cohory/authz";
import { newId, runInCommunity, setRlsValue, withCommunity, type CommunityId } from "@cohory/db";
import {
  auditLog,
  memberships,
  notifications,
  outbox,
  reviewReports,
  reviews,
} from "@cohory/db/schema";
import { createReviewNotifier } from "@cohory/notifications";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { TenureFacts } from "./eligibility";
import {
  AlreadyReviewedError,
  NotEligibleError,
  NotReportedError,
  ReplyExistsError,
  ReviewNotFoundError,
  ReviewsDisabledError,
  ReviewsValidationError,
} from "./errors";
import { createReviewsService, type ReviewsService } from "./service";
import { insertCommunity, insertMember, insertUser, openTestDb } from "./test/fixtures";

const { db, close } = openTestDb();
const dayMs = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-20T12:00:00.000Z");
const longAgo = new Date(now.getTime() - 200 * dayMs);
const body = "A friendly place with useful weekly calls.";

let tenure: Map<string, TenureFacts>;
let service: ReviewsService;

async function lookup(_communityId: string, userIds: readonly string[]) {
  return new Map(
    userIds.flatMap((id) => {
      const facts = tenure.get(id);
      return facts ? [[id, facts] as const] : [];
    }),
  );
}

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

function paying(userId: string, paidSince = longAgo): void {
  tenure.set(userId, {
    providerStatus: "active",
    accessState: "granted",
    interval: "month",
    paidSince,
  });
}

interface World {
  communityId: CommunityId;
  owner: string;
  admin: string;
  moderator: string;
  member: string;
}

async function world(options: { reviewsEnabled?: boolean } = {}): Promise<World> {
  const communityId = await insertCommunity(db, options);
  const owner = await insertMember(db, communityId, { role: "owner", name: "Owner" });
  const admin = await insertMember(db, communityId, { role: "admin", name: "Admin" });
  const moderator = await insertMember(db, communityId, { role: "moderator", name: "Mod" });
  const member = await insertMember(db, communityId, { name: "Paying Member" });
  paying(member);
  return { communityId, owner, admin, moderator, member };
}

async function setStatus(
  communityId: CommunityId,
  userId: string,
  status: "active" | "removed" | "banned",
  reason?: "left" | "removed",
): Promise<void> {
  await runInCommunity(withCommunity(db, communityId), async ({ tx, where }) => {
    if (reason) {
      await setRlsValue(tx, "member_removal_reason", reason);
    }
    await tx
      .update(memberships)
      .set({ status })
      .where(where(memberships, eq(memberships.userId, userId)));
  });
}

beforeEach(() => {
  tenure = new Map();
  service = createReviewsService({
    db,
    now: () => now,
    tenure: lookup,
    notifyOwner: async (notice) => {
      await createReviewNotifier({ db, now: () => now })(notice);
    },
  });
});

afterAll(async () => {
  await close();
});

describe("writing a review", () => {
  it("lets an eligible member review, notifies the owner, and records a domain event", async () => {
    const w = await world();

    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 5, body });

    const page = await service.listReviews(user(w.owner), w.communityId);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      id,
      rating: 5,
      body,
      author: { id: w.member, name: "Paying Member" },
      statusLabel: "Paying member for 6 months",
      editedAt: null,
      reply: null,
    });
    const notes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.communityId, w.communityId), eq(notifications.subjectId, id)));
    expect(notes.map((note) => [note.userId, note.type])).toEqual([[w.owner, "review_created"]]);
    const events = await db
      .select({ payload: outbox.payload })
      .from(outbox)
      .where(eq(outbox.communityId, w.communityId));
    expect(JSON.stringify(events.map((event) => event.payload))).toContain('"review.created"');
  });

  it("refuses when reviews are turned off", async () => {
    const w = await world({ reviewsEnabled: false });
    await expect(
      service.createReview(user(w.member), w.communityId, { rating: 4, body }),
    ).rejects.toBeInstanceOf(ReviewsDisabledError);
    expect(await service.getSummary(user(w.member), w.communityId)).toEqual({ status: "disabled" });
  });

  it("refuses a member who has paid for less than 30 days and explains when they can", async () => {
    const w = await world();
    paying(w.member, new Date(now.getTime() - 29 * dayMs));
    const error = await service
      .createReview(user(w.member), w.communityId, { rating: 4, body })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotEligibleError);
    expect((error as NotEligibleError).userMessage).toContain("You can leave one from");
  });

  it("allows a member exactly 30 days after the first payment", async () => {
    const w = await world();
    paying(w.member, new Date(now.getTime() - 30 * dayMs));
    await expect(
      service.createReview(user(w.member), w.communityId, { rating: 4, body }),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("refuses comped and free members, who have no paid subscription", async () => {
    const w = await world();
    const comped = await insertMember(db, w.communityId);
    await expect(
      service.createReview(user(comped), w.communityId, { rating: 3, body }),
    ).rejects.toBeInstanceOf(NotEligibleError);
  });

  it("treats owners, admins, and moderators like any paying member", async () => {
    const w = await world();
    await expect(
      service.createReview(user(w.admin), w.communityId, { rating: 5, body }),
    ).rejects.toBeInstanceOf(NotEligibleError);
    paying(w.moderator);
    paying(w.owner);
    await service.createReview(user(w.moderator), w.communityId, { rating: 4, body });
    await service.createReview(user(w.owner), w.communityId, { rating: 5, body });
    expect((await service.listReviews(user(w.member), w.communityId)).data).toHaveLength(2);
  });

  it("refuses API and agent tokens even for an eligible member", async () => {
    const w = await world();
    const token: Actor = {
      kind: "user",
      userId: w.member,
      platformAdmin: false,
      credential: {
        type: "user",
        tokenId: newId(),
        agentId: null,
        communityId: w.communityId,
        scopes: ["community:read"],
        via: "api",
      },
    };
    await expect(
      service.createReview(token, w.communityId, { rating: 5, body }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.listReviews(token, w.communityId)).resolves.toMatchObject({
      data: [],
      nextCursor: null,
    });
  });

  it("refuses signed out visitors and validates the text", async () => {
    const w = await world();
    await expect(
      service.createReview({ kind: "guest" }, w.communityId, { rating: 5, body }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      service.createReview(user(w.member), w.communityId, { rating: 6, body }),
    ).rejects.toBeInstanceOf(ReviewsValidationError);
    await expect(
      service.createReview(user(w.member), w.communityId, { rating: 5, body: "Too short." }),
    ).rejects.toBeInstanceOf(ReviewsValidationError);
  });

  it("keeps one review per member, and lets them post again after deleting it", async () => {
    const w = await world();
    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 5, body });
    await expect(
      service.createReview(user(w.member), w.communityId, { rating: 4, body }),
    ).rejects.toBeInstanceOf(AlreadyReviewedError);

    await service.deleteReview(user(w.member), w.communityId, id);
    await service.createReview(user(w.member), w.communityId, { rating: 2, body });

    const page = await service.listReviews(user(w.member), w.communityId);
    expect(page.data.map((review) => review.rating)).toEqual([2]);
  });

  it("marks an edit and refuses edits and deletes by anyone else, the owner included", async () => {
    const w = await world();
    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 2, body });
    await service.updateReview(user(w.member), w.communityId, id, {
      rating: 4,
      body: `${body} Edited.`,
    });
    const [review] = (await service.listReviews(user(w.member), w.communityId)).data;
    expect(review).toMatchObject({ rating: 4, editedAt: now });

    for (const other of [w.owner, w.admin, w.moderator]) {
      await expect(
        service.updateReview(user(other), w.communityId, id, { rating: 5, body }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.deleteReview(user(other), w.communityId, id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});

describe("reading reviews", () => {
  it("lists newest first, filters by stars, pages, and shows the average from three reviews", async () => {
    const w = await world();
    const ratingsInOrder = [5, 3, 4];
    let created = 0;
    for (const rating of ratingsInOrder) {
      const reviewer = await insertMember(db, w.communityId, { name: `Reviewer ${rating}` });
      paying(reviewer);
      const at = new Date(now.getTime() + created * 1000);
      created += 1;
      const timed = createReviewsService({
        db,
        now: () => at,
        tenure: lookup,
      });
      await timed.createReview(user(reviewer), w.communityId, { rating, body });
      if (created === 2) {
        const summary = await service.getSummary({ kind: "guest" }, w.communityId);
        expect(summary).toMatchObject({ status: "enabled", count: 2, average: null });
      }
    }

    const page = await service.listReviews({ kind: "guest" }, w.communityId);
    expect(page.data.map((review) => review.rating)).toEqual([4, 3, 5]);
    const fives = await service.listReviews({ kind: "guest" }, w.communityId, { rating: 5 });
    expect(fives.data.map((review) => review.rating)).toEqual([5]);
    expect(await service.getSummary({ kind: "guest" }, w.communityId)).toMatchObject({
      count: 3,
      average: 4,
      ratings: [
        { rating: 5, count: 1 },
        { rating: 4, count: 1 },
        { rating: 3, count: 1 },
        { rating: 2, count: 0 },
        { rating: 1, count: 0 },
      ],
    });
    const first = await service.listReviews({ kind: "guest" }, w.communityId, { limit: 2 });
    expect(first.data.map((review) => review.rating)).toEqual([4, 3]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await service.listReviews({ kind: "guest" }, w.communityId, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second).toMatchObject({ nextCursor: null });
    expect(second.data.map((review) => review.rating)).toEqual([5]);
    await expect(
      service.listReviews({ kind: "guest" }, w.communityId, { cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("labels a reviewer who cancelled as a former member", async () => {
    const w = await world();
    await service.createReview(user(w.member), w.communityId, { rating: 5, body });
    tenure.set(w.member, {
      providerStatus: "canceled",
      accessState: "revoked",
      interval: "month",
      paidSince: longAgo,
    });
    await setStatus(w.communityId, w.member, "removed");

    const [review] = (await service.listReviews({ kind: "guest" }, w.communityId)).data;
    expect(review?.statusLabel).toBe("Former member");
  });

  it("hides reviews of banned and removed members, keeps those of members who left", async () => {
    const w = await world();
    const leaver = await insertMember(db, w.communityId, { name: "Leaver" });
    const removed = await insertMember(db, w.communityId, { name: "Removed" });
    paying(leaver);
    paying(removed);
    await service.createReview(user(w.member), w.communityId, { rating: 1, body });
    await service.createReview(user(leaver), w.communityId, { rating: 4, body });
    await service.createReview(user(removed), w.communityId, { rating: 2, body });

    await setStatus(w.communityId, w.member, "banned");
    await setStatus(w.communityId, removed, "removed", "removed");
    await setStatus(w.communityId, leaver, "removed", "left");

    const page = await service.listReviews({ kind: "guest" }, w.communityId);
    expect(page.data.map((review) => review.author.name)).toEqual(["Leaver"]);

    await setStatus(w.communityId, removed, "active");
    expect((await service.listReviews({ kind: "guest" }, w.communityId)).data).toHaveLength(2);
  });

  it("keeps reviews but shows none while the owner has reviews turned off", async () => {
    const w = await world();
    await service.createReview(user(w.member), w.communityId, { rating: 5, body });
    await db.execute(
      sql`update communities set reviews_enabled = false where id = ${w.communityId}`,
    );
    expect((await service.listReviews({ kind: "guest" }, w.communityId)).data).toEqual([]);
    const [kept] = await db.select().from(reviews).where(eq(reviews.communityId, w.communityId));
    expect(kept?.rating).toBe(5);
  });

  it("never reads or changes a review through another community", async () => {
    const w = await world();
    const other = await world();
    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 5, body });

    await expect(
      service.deleteReview(user(w.member), other.communityId, id),
    ).rejects.toBeInstanceOf(ReviewNotFoundError);
    await expect(
      service.replyToReview(user(other.owner), other.communityId, id, { body: "Thanks" }),
    ).rejects.toBeInstanceOf(ReviewNotFoundError);
    expect((await service.listReviews({ kind: "guest" }, other.communityId)).data).toHaveLength(0);
  });
});

describe("owner replies", () => {
  it("lets only the owner post one reply, edit it, and delete it", async () => {
    const w = await world();
    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 3, body });

    for (const other of [w.admin, w.moderator, w.member]) {
      await expect(
        service.replyToReview(user(other), w.communityId, id, { body: "Thanks" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await service.replyToReview(user(w.owner), w.communityId, id, { body: "Thanks for this." });
    await expect(
      service.replyToReview(user(w.owner), w.communityId, id, { body: "Again" }),
    ).rejects.toBeInstanceOf(ReplyExistsError);
    await service.updateReply(user(w.owner), w.communityId, id, { body: "Thank you." });

    const [review] = (await service.listReviews({ kind: "guest" }, w.communityId)).data;
    expect(review?.reply).toMatchObject({ body: "Thank you.", editedAt: now });

    await service.deleteReply(user(w.owner), w.communityId, id);
    const [after] = (await service.listReviews({ kind: "guest" }, w.communityId)).data;
    expect(after?.reply).toBeNull();
  });
});

describe("reports and hiding", () => {
  it("lets anyone signed in report, and only the owner hide a reported review", async () => {
    const w = await world();
    const visitor = await insertUser(db, "Visitor");
    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 1, body });

    await expect(
      service.hideReview(user(w.owner), w.communityId, id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(NotReportedError);
    await expect(
      service.reportReview(user(w.member), w.communityId, id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.reportReview({ kind: "guest" }, w.communityId, id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);

    await service.reportReview(user(visitor), w.communityId, id, { reason: "spam", note: "Ad" });
    const queue = await service.listReviewReports(user(w.moderator), w.communityId);
    expect(queue).toMatchObject({ openCount: 1, data: [{ reviewId: id, reportCount: 1 }] });
    expect(await service.countOpenReviewReports(user(w.moderator), w.communityId)).toBe(1);
    await expect(
      service.countOpenReviewReports(user(w.member), w.communityId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.listReviewReports(user(w.member), w.communityId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    for (const staff of [w.admin, w.moderator]) {
      await expect(
        service.hideReview(user(staff), w.communityId, id, { reason: "spam" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await service.hideReview(user(w.owner), w.communityId, id, { reason: "spam" });

    expect((await service.listReviews({ kind: "guest" }, w.communityId)).data).toHaveLength(0);
    expect(await service.getSummary({ kind: "guest" }, w.communityId)).toMatchObject({
      count: 0,
      hidden: [{ reason: "spam", count: 1 }],
    });
    const [report] = await db.select().from(reviewReports).where(eq(reviewReports.reviewId, id));
    expect(report?.status).toBe("hidden");
    const entries = await db
      .select({ action: auditLog.action, target: auditLog.target })
      .from(auditLog)
      .where(eq(auditLog.communityId, w.communityId));
    expect(entries).toContainEqual({ action: "review.hidden", target: id });
    const state = await service.getViewerState(user(w.member), w.communityId);
    expect(state.ownReview).toMatchObject({ id, hiddenReason: "spam" });
  });

  it("lets staff dismiss reports without hiding the review", async () => {
    const w = await world();
    const reporter = await insertMember(db, w.communityId);
    const { id } = await service.createReview(user(w.member), w.communityId, { rating: 2, body });
    await service.reportReview(user(reporter), w.communityId, id, { reason: "other" });

    expect(await service.dismissReviewReports(user(w.moderator), w.communityId, id)).toEqual({
      resolved: 1,
    });
    expect((await service.listReviews({ kind: "guest" }, w.communityId)).data).toHaveLength(1);
    await expect(
      service.hideReview(user(w.owner), w.communityId, id, { reason: "spam" }),
    ).rejects.toBeInstanceOf(NotReportedError);
  });
});

describe("viewer state", () => {
  it("explains the rule to a member who cannot review yet", async () => {
    const w = await world();
    const free = await insertMember(db, w.communityId);
    const state = await service.getViewerState(user(free), w.communityId);
    expect(state).toMatchObject({
      enabled: true,
      ownReview: null,
      eligibility: { eligible: false, reason: "no_subscription" },
      eligibilityMessage: "Members who have paid for at least 30 days can leave a review.",
      canReply: false,
      canReport: true,
      canHide: false,
    });
    const owner = await service.getViewerState(user(w.owner), w.communityId);
    expect(owner).toMatchObject({ canReply: true, canHide: true });
  });

  it("scopes reviews to the community in the database", async () => {
    const w = await world();
    await service.createReview(user(w.member), w.communityId, { rating: 5, body });
    const other = await world();
    const rows = await runInCommunity(withCommunity(db, other.communityId), ({ tx, where }) =>
      tx.select().from(reviews).where(where(reviews)),
    );
    expect(rows).toEqual([]);
  });
});
