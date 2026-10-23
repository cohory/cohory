import { ForbiddenError, type Actor } from "@cohory/authz";
import type { QueuedEmail } from "@cohory/email";
import { describe, expect, it } from "vitest";

import { createFakeStore } from "./fake-store";
import { createCreatorFeedbackService, type CreatorFeedbackServiceDeps } from "./service";

const owner = "0199a1b2-0000-7000-8000-000000000001";
const admin = "0199a1b2-0000-7000-8000-000000000002";
const stranger = "0199a1b2-0000-7000-8000-000000000003";
const painters = "0199a1b2-0000-7000-8000-00000000c001";
const runners = "0199a1b2-0000-7000-8000-00000000c002";
const day = 24 * 60 * 60 * 1000;
const start = new Date("2026-10-23T09:00:00.000Z");

function user(userId: string): Actor {
  return { kind: "user", userId, platformAdmin: false };
}

function setup(overrides: Partial<CreatorFeedbackServiceDeps> = {}) {
  let clock = start.getTime();
  const fake = createFakeStore();
  fake.addCommunity(painters, "painters", { [owner]: "owner", [admin]: "admin" });
  fake.addCommunity(runners, "runners", { [owner]: "owner", [stranger]: "member" });
  fake.addCommunity("0199a1b2-0000-7000-8000-00000000c003", "elsewhere", {
    [stranger]: "owner",
  });
  const sent: QueuedEmail[] = [];
  const service = createCreatorFeedbackService({
    store: fake.store,
    outbox: {
      send: async (email) => {
        sent.push(email);
      },
    },
    contactEmail: "hello@operator.example.com",
    edition: "cloud",
    instanceUrl: "https://cohory.example.com",
    isFirstMoment: async () => true,
    now: () => new Date(clock),
    ...overrides,
  });
  return {
    service,
    fake,
    sent,
    advance(days: number) {
      clock += days * day;
    },
  };
}

function feedbackData(email: QueuedEmail | undefined) {
  if (email?.template !== "creator-feedback") {
    throw new Error("expected a creator feedback email");
  }
  return email.data;
}

describe("creator feedback moments", () => {
  it("records a pending moment for the owner and shows it on that community only", async () => {
    const { service } = setup();

    expect(await service.recordMoment({ communityId: painters, moment: "first_post" })).toBe(
      "recorded",
    );

    expect(await service.nextQuestion(user(owner), painters)).toMatchObject({
      moment: "first_post",
      question: "How easy was it to publish your first post?",
    });
    expect(await service.nextQuestion(user(owner), runners)).toBeNull();
    expect(await service.nextQuestion(user(admin), painters)).toBeNull();
  });

  it("asks each moment at most once per community", async () => {
    const { service, fake } = setup();

    await service.recordMoment({ communityId: painters, moment: "first_post" });
    expect(await service.recordMoment({ communityId: painters, moment: "first_post" })).toBe(
      "already_recorded",
    );
    await service.respond(user(owner), {
      communityId: painters,
      moment: "first_post",
      outcome: "answered",
      score: 5,
    });

    expect(await service.recordMoment({ communityId: painters, moment: "first_post" })).toBe(
      "already_recorded",
    );
    expect(fake.rows.filter((row) => row.topic === "first_post")).toHaveLength(1);
  });

  it("skips a moment that is not the community's first", async () => {
    const { service, fake } = setup({ isFirstMoment: async () => false });

    expect(await service.recordMoment({ communityId: painters, moment: "first_course" })).toBe(
      "not_first",
    );
    expect(fake.rows).toEqual([]);
  });

  it("asks at most one question per creator in any 30 days across moments and communities", async () => {
    const { service, advance } = setup();
    await service.recordMoment({ communityId: painters, moment: "first_post" });
    await service.recordMoment({ communityId: runners, moment: "first_course" });

    expect(await service.nextQuestion(user(owner), runners)).toBeNull();
    await service.respond(user(owner), {
      communityId: painters,
      moment: "first_post",
      outcome: "snoozed",
    });
    advance(29);
    expect(await service.nextQuestion(user(owner), runners)).toBeNull();

    advance(2);
    expect(await service.nextQuestion(user(owner), runners)).toMatchObject({
      moment: "first_course",
    });
  });

  it("stops offering a moment that waited longer than 90 days", async () => {
    const { service, advance } = setup();
    await service.recordMoment({ communityId: painters, moment: "first_post" });

    advance(91);

    expect(await service.nextQuestion(user(owner), painters)).toBeNull();
  });

  it("never asks a creator who opted out and stores no new moment for them", async () => {
    const { service, fake } = setup();
    await service.recordMoment({ communityId: painters, moment: "first_post" });

    await service.respond(user(owner), {
      communityId: painters,
      moment: "first_post",
      outcome: "dismissed",
      optOut: true,
    });

    expect(fake.optOuts.has(owner)).toBe(true);
    expect(await service.recordMoment({ communityId: runners, moment: "first_post" })).toBe(
      "opted_out",
    );
    expect(await service.nextQuestion(user(owner), runners)).toBeNull();
    expect(await service.preferences(user(owner))).toEqual({ available: true, optedOut: true });
  });

  it("lets the creator turn questions back on from account settings", async () => {
    const { service, fake } = setup();
    await service.setOptOut(user(owner), true);

    await service.setOptOut(user(owner), false);

    expect(fake.optOuts.has(owner)).toBe(false);
    expect(await service.preferences(user(owner))).toEqual({ available: true, optedOut: false });
  });

  it("records an answer, a dismissal, and a not now, and emails only the answer", async () => {
    const { service, fake, sent } = setup();
    for (const [communityId, moment] of [
      [painters, "first_post"],
      [painters, "first_course"],
      [runners, "first_paid_member"],
    ] as const) {
      await service.recordMoment({ communityId, moment });
    }

    await service.respond(user(owner), {
      communityId: painters,
      moment: "first_post",
      outcome: "answered",
      score: 4,
      comment: "  Finding the category took a while.  ",
    });
    await service.respond(user(owner), {
      communityId: painters,
      moment: "first_course",
      outcome: "dismissed",
    });
    await service.respond(user(owner), {
      communityId: runners,
      moment: "first_paid_member",
      outcome: "snoozed",
    });

    expect(
      fake.rows.map(({ topic, status, score, comment }) => [topic, status, score, comment]),
    ).toEqual([
      ["first_post", "answered", 4, "Finding the category took a while."],
      ["first_course", "dismissed", null, null],
      ["first_paid_member", "snoozed", null, null],
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("hello@operator.example.com");
    expect(feedbackData(sent[0])).toEqual({
      kind: "moment",
      topic: "First post",
      question: "How easy was it to publish your first post?",
      score: 4,
      reason: null,
      comment: "Finding the category took a while.",
      userId: owner,
      communitySlug: "painters",
      edition: "cloud",
      instanceUrl: "https://cohory.example.com",
      sentAt: "2026-10-23T09:00:00.000Z",
    });
  });

  it("refuses an answer without a score or with a comment over 1000 characters", async () => {
    const { service } = setup();
    await service.recordMoment({ communityId: painters, moment: "first_post" });

    await expect(
      service.respond(user(owner), {
        communityId: painters,
        moment: "first_post",
        outcome: "answered",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.respond(user(owner), {
        communityId: painters,
        moment: "first_post",
        outcome: "answered",
        score: 3,
        comment: "a".repeat(1001),
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("denies answers from an admin, a member of another community, and an API token", async () => {
    const { service, fake } = setup();
    await service.recordMoment({ communityId: painters, moment: "first_post" });
    const answer = {
      communityId: painters,
      moment: "first_post",
      outcome: "answered",
      score: 2,
    } as const;

    await expect(service.respond(user(admin), answer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.respond(user(stranger), answer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.respond(
        {
          kind: "user",
          userId: owner,
          platformAdmin: false,
          credential: {
            type: "user",
            tokenId: "token",
            agentId: null,
            communityId: painters,
            scopes: [],
            via: "api",
          },
        },
        answer,
      ),
    ).rejects.toThrow();
    expect(fake.rows[0]?.status).toBe("pending");
  });
});

describe("creator exit reasons", () => {
  it("stores the reason and comment and emails the operator", async () => {
    const { service, fake, sent } = setup();

    expect(
      await service.recordExit(user(owner), {
        communityId: painters,
        action: "archive_community",
        reason: "too_expensive",
        comment: "Members did not renew.",
      }),
    ).toBe(true);

    expect(fake.rows).toMatchObject([
      {
        kind: "exit",
        topic: "archive_community",
        status: "answered",
        reason: "too_expensive",
        comment: "Members did not renew.",
        communityId: painters,
      },
    ]);
    expect(feedbackData(sent[0])).toMatchObject({
      kind: "exit",
      topic: "Archived a community",
      reason: "Too expensive",
      communitySlug: "painters",
    });
  });

  it("stores nothing when the creator gives no reason or comment", async () => {
    const { service, fake, sent } = setup();

    expect(
      await service.recordExit(user(owner), {
        communityId: painters,
        action: "delete_community",
        reason: null,
        comment: "   ",
      }),
    ).toBe(false);

    expect(fake.rows).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("records account deletion without a community for the account holder", async () => {
    const { service, fake, sent } = setup();

    await service.recordExit(user(stranger), {
      communityId: null,
      action: "delete_account",
      reason: "only_testing",
    });

    expect(fake.rows[0]).toMatchObject({ userId: stranger, communityId: null });
    expect(feedbackData(sent[0])).toMatchObject({ communitySlug: null, userId: stranger });
  });

  it("denies a community exit reason from anyone but that community's owner", async () => {
    const { service, fake } = setup();
    const exit = { communityId: painters, action: "disconnect_stripe", reason: "other" } as const;

    await expect(service.recordExit(user(admin), exit)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.recordExit(user(stranger), exit)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.recordExit({ kind: "guest" }, exit)).rejects.toThrow();
    expect(fake.rows).toEqual([]);
  });

  it("refuses an account action with a community and a community action without one", async () => {
    const { service } = setup();

    await expect(
      service.recordExit(user(owner), {
        communityId: painters,
        action: "delete_account",
        reason: "other",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      service.recordExit(user(owner), {
        communityId: null,
        action: "archive_community",
        reason: "other",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("creator feedback on the Community Edition", () => {
  it("stores and shows nothing and sends no email", async () => {
    const { service, fake, sent } = setup({ edition: "community" });

    expect(await service.recordMoment({ communityId: painters, moment: "first_post" })).toBe(
      "unavailable",
    );
    expect(await service.nextQuestion(user(owner), painters)).toBeNull();
    expect(
      await service.recordExit(user(owner), {
        communityId: painters,
        action: "archive_community",
        reason: "too_expensive",
      }),
    ).toBe(false);
    expect(
      await service.respond(user(owner), {
        communityId: painters,
        moment: "first_post",
        outcome: "dismissed",
        optOut: true,
      }),
    ).toBe(false);
    await service.setOptOut(user(owner), true);

    expect(fake.rows).toEqual([]);
    expect(fake.optOuts.size).toBe(0);
    expect(sent).toEqual([]);
    expect(await service.preferences(user(owner))).toEqual({ available: false, optedOut: false });
  });
});

describe("creator feedback email payload", () => {
  it("carries ids, labels, and the answer but no email address, name, token, or secret", async () => {
    const { service, sent } = setup();
    await service.recordMoment({ communityId: painters, moment: "first_post" });
    await service.respond(user(owner), {
      communityId: painters,
      moment: "first_post",
      outcome: "answered",
      score: 3,
    });
    await service.recordExit(user(owner), {
      communityId: null,
      action: "delete_account",
      comment: "Bye",
    });

    for (const email of sent) {
      const payload = JSON.stringify(email.data);
      expect(Object.keys(email.data).sort()).toEqual(
        [
          "comment",
          "communitySlug",
          "edition",
          "instanceUrl",
          "kind",
          "question",
          "reason",
          "score",
          "sentAt",
          "topic",
          "userId",
        ].sort(),
      );
      expect(payload).not.toMatch(/@|secret|token|password|cookie/i);
    }
  });

  it("stores the answer but sends nothing when no contact address is set", async () => {
    const { service, fake, sent } = setup({ contactEmail: null });

    await service.recordExit(user(owner), {
      communityId: painters,
      action: "archive_community",
      reason: "too_hard",
    });

    expect(fake.rows).toHaveLength(1);
    expect(sent).toEqual([]);
  });
});

describe("creator feedback retention", () => {
  it("removes answers older than 24 months and keeps newer ones", async () => {
    const { service, fake, advance } = setup();
    await service.recordExit(user(owner), {
      communityId: painters,
      action: "archive_community",
      reason: "too_expensive",
    });
    advance(400);
    await service.recordExit(user(owner), {
      communityId: null,
      action: "delete_account",
      comment: "Moving on.",
    });
    advance(400);

    expect(await service.removeExpired()).toBe(1);
    expect(fake.rows.map((row) => row.topic)).toEqual(["delete_account"]);
  });

  it("removes expired answers on the Community Edition too", async () => {
    const { service, fake } = setup({ edition: "community" });
    fake.rows.push({
      userId: owner,
      communityId: null,
      kind: "exit",
      topic: "delete_account",
      status: "answered",
      score: null,
      reason: null,
      comment: "Left from Cloud.",
      createdAt: new Date(start.getTime() - 800 * day),
      respondedAt: new Date(start.getTime() - 800 * day),
    });

    expect(await service.removeExpired()).toBe(1);
    expect(fake.rows).toEqual([]);
  });
});
