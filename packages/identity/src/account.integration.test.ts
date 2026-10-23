import { randomBytes } from "node:crypto";

import type { Actor } from "@cohory/authz";
import {
  createCommunityWithOwner,
  createDb,
  createPool,
  newId,
  parseAdminDatabaseEnv,
  communitySlugSchema,
} from "@cohory/db";
import { migrationLockKey } from "@cohory/db/migrations";
import { accountAuditLog, sessions, users } from "@cohory/db/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAccountService, deletionGraceDays } from "./account-service";
import { AccountConfirmationError, AccountDeletionBlockedError } from "./errors";
import { createAccountPurge, erasedEmail, formerMemberName } from "./purge";

const probeRole = "cohory_identity_probe";
const adminUrl = parseAdminDatabaseEnv().DATABASE_ADMIN_URL;
const adminPool = createPool(adminUrl);
const adminDb = createDb(adminPool);
const appUrl = new URL(adminUrl);
appUrl.searchParams.set("options", `-c role=${probeRole}`);
const appPool = createPool(appUrl.toString());
const appDb = createDb(appPool);

const dayMs = 24 * 60 * 60 * 1000;
let clock = new Date("2026-10-18T10:00:00Z").getTime();
const now = () => new Date(clock);
const billingCommunities = new Set<string>();
const paidCommunityBlockers = async (ids: readonly string[]) =>
  new Set(ids.filter((id) => billingCommunities.has(id)));
const accountsService = createAccountService({ db: appDb, now, paidCommunityBlockers });
const deletedAvatars: string[] = [];
const released: string[] = [];
const failBillingFor = new Set<string>();
const purge = createAccountPurge({
  db: appDb,
  now,
  paidCommunityBlockers,
  deleteAvatar: async (userId) => {
    deletedAvatars.push(userId);
  },
  releaseBilling: async (communityId, userId) => {
    if (failBillingFor.has(userId)) {
      throw new Error("Stripe is down");
    }
    released.push(`${communityId}:${userId}`);
  },
});

type UserActor = Actor & { kind: "user" };

interface Person {
  readonly actor: UserActor;
  readonly email: string;
}

async function person(name: string): Promise<Person> {
  const email = `identity-${newId()}@example.test`;
  const [row] = await adminDb
    .insert(users)
    .values({
      name,
      email,
      image: "/api/uploads/avatars/x.png",
      username: `u${newId().slice(-10)}`,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert returned no row");
  return { actor: { kind: "user", userId: row.id, platformAdmin: false }, email };
}

async function signIn(
  who: Person,
  userAgent = "Mozilla/5.0 (Macintosh) Firefox/140.0",
): Promise<string> {
  const id = newId();
  await adminDb.insert(sessions).values({
    id,
    userId: who.actor.userId,
    token: `token-${id}`,
    expiresAt: new Date(clock + 7 * dayMs),
    userAgent,
  });
  return id;
}

async function community(owner: Person, name: string) {
  const result = await createCommunityWithOwner(adminDb, {
    slug: communitySlugSchema.parse(`id-${newId().slice(-12)}`),
    name,
    ownerUserId: owner.actor.userId,
  });
  if (result.kind !== "created") throw new Error("slug taken");
  return result.community;
}

async function join(communityId: string, who: Person): Promise<void> {
  await adminDb.execute(
    sql`insert into memberships (id, community_id, user_id, role, status, bio, joined_at) values (${newId()}, ${communityId}, ${who.actor.userId}, 'member', 'active', 'Hello there', now())`,
  );
}

async function auditActions(who: Person): Promise<string[]> {
  const rows = await adminDb
    .select({ action: accountAuditLog.action })
    .from(accountAuditLog)
    .where(eq(accountAuditLog.userId, who.actor.userId))
    .orderBy(accountAuditLog.createdAt);
  return rows.map((row) => row.action);
}

beforeAll(async () => {
  await adminDb.execute(
    sql.raw(`
    select pg_advisory_xact_lock(${migrationLockKey});
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${probeRole}') then
        create role ${probeRole} nologin nosuperuser nobypassrls;
      end if;
    end $$;
    grant select on communities to ${probeRole};
    grant select, insert, update, delete on users, sessions, accounts, verifications, memberships, outbox, event_rsvps, lesson_progress, member_stats, notifications, notification_preferences, notification_settings, notification_deliveries, notification_group_sources, creator_feedback, account_audit_log, membership_requests, content_reports, comped_memberships, comp_invitations, api_tokens, agent_identities, reviews, review_reports to ${probeRole};
  `),
  );
});

afterAll(async () => {
  await appPool.end();
  await adminPool.end();
});

describe("requesting account deletion", () => {
  it("refuses when the typed email does not match", async () => {
    const ada = await person("Ada");

    await expect(
      accountsService.requestDeletion(ada.actor, { confirmation: "someone@example.test" }),
    ).rejects.toBeInstanceOf(AccountConfirmationError);
    expect((await accountsService.deletionStatus(ada.actor)).scheduledFor).toBeNull();
  });

  it("blocks an owner and lists the communities to transfer or archive", async () => {
    const owner = await person("Owner");
    const makers = await community(owner, "Makers");
    const archived = await community(owner, "Old club");
    await adminDb.execute(
      sql`update communities set archived_at = now() where id = ${archived.id}`,
    );

    const failure = await accountsService
      .requestDeletion(owner.actor, { confirmation: owner.email })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AccountDeletionBlockedError);
    expect(failure instanceof AccountDeletionBlockedError ? failure.communities : []).toEqual([
      { id: makers.id, slug: makers.slug, name: "Makers", reason: "active" },
    ]);
  });

  it("blocks deletion for an archived community that still bills members", async () => {
    const owner = await person("Billing owner");
    const archived = await community(owner, "Paid archive");
    await adminDb.execute(
      sql`update communities set archived_at = now() where id = ${archived.id}`,
    );
    billingCommunities.add(archived.id);

    const failure = await accountsService
      .requestDeletion(owner.actor, { confirmation: owner.email })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AccountDeletionBlockedError);
    expect(failure instanceof AccountDeletionBlockedError ? failure.communities : []).toEqual([
      { id: archived.id, slug: archived.slug, name: "Paid archive", reason: "billing" },
    ]);
    expect(await accountsService.ownedCommunities(owner.actor)).toEqual([
      { id: archived.id, slug: archived.slug, name: "Paid archive", reason: "billing" },
    ]);
    expect((await accountsService.deletionStatus(owner.actor)).scheduledFor).toBeNull();
  });

  it("allows deletion when the only owned community is archived with nothing billing", async () => {
    const owner = await person("Quiet owner");
    const archived = await community(owner, "Quiet archive");
    await adminDb.execute(
      sql`update communities set archived_at = now() where id = ${archived.id}`,
    );

    expect(await accountsService.ownedCommunities(owner.actor)).toEqual([]);
    const status = await accountsService.requestDeletion(owner.actor, {
      confirmation: owner.email,
    });
    expect(status.scheduledFor).not.toBeNull();
  });

  it("schedules deletion 14 days out, signs out every session, and writes the audit log", async () => {
    const bob = await person("Bob");
    await signIn(bob);
    await signIn(bob);

    const status = await accountsService.requestDeletion(bob.actor, {
      confirmation: ` ${bob.email.toUpperCase()} `,
    });

    expect(status.scheduledFor).toEqual(new Date(clock + deletionGraceDays * dayMs));
    expect(
      await adminDb.select().from(sessions).where(eq(sessions.userId, bob.actor.userId)),
    ).toEqual([]);
    expect(await auditActions(bob)).toEqual(["account.deletion_requested"]);
  });
});

describe("the grace period", () => {
  it("keeps the account when deletion is cancelled before the date", async () => {
    const cy = await person("Cy");
    await accountsService.requestDeletion(cy.actor, { confirmation: cy.email });
    const start = clock;
    clock += 3 * dayMs;

    await accountsService.cancelDeletion(cy.actor);
    clock = start + (deletionGraceDays + 1) * dayMs;
    await purge.purgeDueAccounts();
    clock = start;

    const [row] = await adminDb.select().from(users).where(eq(users.id, cy.actor.userId));
    expect(row).toMatchObject({
      name: "Cy",
      email: cy.email,
      erasedAt: null,
      deletionScheduledFor: null,
    });
    expect(await auditActions(cy)).toEqual([
      "account.deletion_requested",
      "account.deletion_cancelled",
    ]);
  });

  it("does nothing before the scheduled date", async () => {
    const dee = await person("Dee");
    await accountsService.requestDeletion(dee.actor, { confirmation: dee.email });

    expect(await purge.purgeAccount(dee.actor.userId)).toBe("not_due");
  });
});

describe("erasing an account after the grace period", () => {
  it("anonymizes authored content, removes memberships, RSVPs, progress, and personal data", async () => {
    const owner = await person("Owner two");
    const eve = await person("Eve");
    const club = await community(owner, "Gardeners");
    await join(club.id, eve);
    const ids = {
      post: newId(),
      comment: newId(),
      event: newId(),
      occurrence: newId(),
      course: newId(),
      module: newId(),
      lesson: newId(),
    };
    await adminDb.execute(sql`
      insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt)
        values (${ids.post}, ${club.id}, ${eve.actor.userId}, '{}'::jsonb, '<p>Hi</p>', 'Hi', 'Hi');
      `);
    await adminDb.execute(sql`
      insert into comments (id, community_id, post_id, author_id, body, body_html, body_text)
        values (${ids.comment}, ${club.id}, ${ids.post}, ${eve.actor.userId}, '{}'::jsonb, '<p>Yo</p>', 'Yo')`);
    await adminDb.execute(sql`
      insert into events (id, community_id, slug, title, starts_at_local, time_zone, duration_minutes)
        values (${ids.event}, ${club.id}, 'call', 'Call', '2026-11-01 18:00', 'UTC', 60)`);
    await adminDb.execute(sql`
      insert into event_occurrences (id, community_id, event_id, starts_at, ends_at)
        values (${ids.occurrence}, ${club.id}, ${ids.event}, '2026-11-01T18:00Z', '2026-11-01T19:00Z')`);
    await adminDb.execute(sql`
      insert into event_rsvps (community_id, occurrence_id, user_id, status)
        values (${club.id}, ${ids.occurrence}, ${eve.actor.userId}, 'going')`);
    await adminDb.execute(sql`
      insert into courses (id, community_id, slug, title, position) values (${ids.course}, ${club.id}, 'basics', 'Basics', 0)`);
    await adminDb.execute(sql`
      insert into course_modules (id, community_id, course_id, title, position) values (${ids.module}, ${club.id}, ${ids.course}, 'One', 0)`);
    await adminDb.execute(sql`
      insert into lessons (id, community_id, module_id, course_id, slug, title, position) values (${ids.lesson}, ${club.id}, ${ids.module}, ${ids.course}, 'first', 'First', 0)`);
    await adminDb.execute(sql`
      insert into lesson_progress (community_id, lesson_id, course_id, user_id, last_viewed_at) values (${club.id}, ${ids.lesson}, ${ids.course}, ${eve.actor.userId}, now())`);
    await adminDb.execute(sql`
      insert into member_stats (community_id, user_id, points_total, level, updated_at) values (${club.id}, ${eve.actor.userId}, 5, 1, now())`);
    await adminDb.execute(sql`
      insert into accounts (id, user_id, account_id, provider_id, password) values (${newId()}, ${eve.actor.userId}, ${eve.actor.userId}, 'credential', 'hash')`);
    await accountsService.requestDeletion(eve.actor, { confirmation: eve.email });
    await signIn(eve);
    clock += (deletionGraceDays + 1) * dayMs;

    const result = await purge.purgeDueAccounts();

    expect(result.erased).toBeGreaterThanOrEqual(1);
    const [user] = await adminDb.select().from(users).where(eq(users.id, eve.actor.userId));
    expect(user).toMatchObject({
      name: formerMemberName,
      email: erasedEmail(eve.actor.userId),
      image: null,
      username: null,
      emailVerified: false,
    });
    expect(user?.erasedAt).not.toBeNull();
    const count = async (table: string) => {
      const rows = await adminDb.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${eve.actor.userId}`,
      );
      return rows.rows[0]?.n;
    };
    expect(await count("sessions")).toBe(0);
    expect(await count("accounts")).toBe(0);
    expect(await count("event_rsvps")).toBe(0);
    expect(await count("lesson_progress")).toBe(0);
    expect(await count("member_stats")).toBe(0);
    const membership = await adminDb.execute<{ status: string; bio: string | null }>(
      sql`select status, bio from memberships where user_id = ${eve.actor.userId}`,
    );
    expect(membership.rows).toEqual([{ status: "removed", bio: null }]);
    const post = await adminDb.execute<{ author_id: string; body_text: string }>(
      sql`select author_id, body_text from posts where id = ${ids.post}`,
    );
    expect(post.rows).toEqual([{ author_id: eve.actor.userId, body_text: "Hi" }]);
    const comment = await adminDb.execute<{ n: number }>(
      sql`select count(*)::int as n from comments where id = ${ids.comment}`,
    );
    expect(comment.rows[0]?.n).toBe(1);
    expect(deletedAvatars).toContain(eve.actor.userId);
    expect(released).toContain(`${club.id}:${eve.actor.userId}`);
    expect(await auditActions(eve)).toEqual(["account.deletion_requested", "account.erased"]);
    expect(await purge.purgeAccount(eve.actor.userId)).toBe("not_due");
  });

  it("clears join answers, report notes, and comps in every community, and records leaving", async () => {
    const owner = await person("Owner three");
    const fay = await person("Fay");
    const club = await community(owner, "Weavers");
    const other = await community(owner, "Knitters");
    await join(club.id, fay);
    const ids = {
      post: newId(),
      report: newId(),
      request: newId(),
      comp: newId(),
      review: newId(),
      reviewReport: newId(),
      ownerReview: newId(),
    };
    await adminDb.execute(sql`
      insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt)
        values (${ids.post}, ${club.id}, ${owner.actor.userId}, '{}'::jsonb, '<p>Hi</p>', 'Hi', 'Hi')`);
    await adminDb.execute(sql`
      insert into content_reports (id, community_id, post_id, reporter_id, reason, note)
        values (${ids.report}, ${club.id}, ${ids.post}, ${fay.actor.userId}, 'spam', 'My neighbour posts this')`);
    await adminDb.execute(sql`
      insert into membership_requests (id, community_id, user_id, status, answers, decision_note)
        values (${ids.request}, ${other.id}, ${fay.actor.userId}, 'declined',
          '[{"question":"Why?","answer":"I live at 5 Elm Street"}]'::jsonb, 'Not local')`);
    await adminDb.execute(sql`
      insert into comped_memberships (id, community_id, user_id, granted_by, note)
        values (${ids.comp}, ${club.id}, ${fay.actor.userId}, ${owner.actor.userId}, 'Fay is my cousin')`);
    await adminDb.execute(sql`
      insert into comp_invitations (id, community_id, email, granted_by, note, accepted_at, accepted_by, comp_id)
        values (${newId()}, ${club.id}, ${fay.email}, ${owner.actor.userId}, 'Fay is my cousin', now(), ${fay.actor.userId}, ${ids.comp})`);
    await adminDb.execute(sql`
      insert into reviews (id, community_id, author_id, rating, body)
        values (${ids.review}, ${club.id}, ${fay.actor.userId}, 4, 'Fay here, from 5 Elm Street, I love it.'),
          (${ids.ownerReview}, ${other.id}, ${owner.actor.userId}, 5, 'The owner reviewed this one too.')`);
    await adminDb.execute(sql`
      insert into review_reports (id, community_id, review_id, reporter_id, reason, note)
        values (${ids.reviewReport}, ${other.id}, ${ids.ownerReview}, ${fay.actor.userId}, 'spam', 'Fay thinks so')`);
    await accountsService.requestDeletion(fay.actor, { confirmation: fay.email });
    clock += (deletionGraceDays + 1) * dayMs;

    expect(await purge.purgeAccount(fay.actor.userId)).toBe("erased");

    const review = await adminDb.execute<{
      author_id: string | null;
      anonymized_at: Date | null;
      author_removed_at: Date | null;
    }>(
      sql`select author_id, anonymized_at, author_removed_at from reviews where id = ${ids.review}`,
    );
    expect(review.rows[0]).toMatchObject({ author_removed_at: null });
    expect(review.rows[0]?.anonymized_at).not.toBeNull();
    const ownerReview = await adminDb.execute<{ author_id: string | null }>(
      sql`select author_id from reviews where id = ${ids.ownerReview}`,
    );
    expect(ownerReview.rows).toEqual([{ author_id: owner.actor.userId }]);
    const reviewReport = await adminDb.execute<{ note: string | null }>(
      sql`select note from review_reports where id = ${ids.reviewReport}`,
    );
    expect(reviewReport.rows).toEqual([{ note: null }]);

    const request = await adminDb.execute<{ answers: unknown; decision_note: string | null }>(
      sql`select answers, decision_note from membership_requests where id = ${ids.request}`,
    );
    expect(request.rows).toEqual([{ answers: [], decision_note: null }]);
    const report = await adminDb.execute<{ note: string | null }>(
      sql`select note from content_reports where id = ${ids.report}`,
    );
    expect(report.rows).toEqual([{ note: null }]);
    const comps = await adminDb.execute<{ n: number }>(
      sql`select count(*)::int as n from comped_memberships where user_id = ${fay.actor.userId}`,
    );
    expect(comps.rows[0]?.n).toBe(0);
    const invitations = await adminDb.execute<{ n: number }>(
      sql`select count(*)::int as n from comp_invitations where community_id = ${club.id}`,
    );
    expect(invitations.rows[0]?.n).toBe(0);
    const removed = await adminDb.execute<{
      payload: { events: { type: string; payload: { userId: string; reason?: string } }[] };
    }>(sql`select payload from outbox where community_id = ${club.id} and topic = 'domain_events'`);
    const events = removed.rows.flatMap((row) => row.payload.events);
    expect(
      events.find(
        (event) => event.type === "member.removed" && event.payload.userId === fay.actor.userId,
      )?.payload.reason,
    ).toBe("left");
  });

  it("revokes the person's API tokens and the agents they own in every community", async () => {
    const owner = await person("Owner four");
    const gus = await person("Gus");
    const club = await community(owner, "Potters");
    await join(club.id, gus);
    const ids = { agent: newId(), agentToken: newId(), personalToken: newId() };
    const hash = () => randomBytes(32).toString("hex");
    await adminDb.execute(sql`
      insert into agent_identities (id, community_id, owner_id, name, scopes, created_by)
        values (${ids.agent}, ${club.id}, ${gus.actor.userId}, 'Helper', '{proposals:write,courses:read}', ${gus.actor.userId})`);
    await adminDb.execute(sql`
      insert into api_tokens (id, community_id, kind, user_id, agent_id, name, token_hash, prefix, scopes, expires_at, created_by)
        values
          (${ids.agentToken}, ${club.id}, 'agent', ${gus.actor.userId}, ${ids.agent}, 'Agent key', ${hash()}, 'cohory_a', '{proposals:write}', ${new Date(clock + 30 * dayMs)}, ${gus.actor.userId}),
          (${ids.personalToken}, ${club.id}, 'personal', ${gus.actor.userId}, null, 'My key', ${hash()}, 'cohory_p', '{posts:read}', ${new Date(clock + 30 * dayMs)}, ${gus.actor.userId})`);
    await accountsService.requestDeletion(gus.actor, { confirmation: gus.email });
    clock += (deletionGraceDays + 1) * dayMs;

    expect(await purge.purgeAccount(gus.actor.userId)).toBe("erased");

    const tokens = await adminDb.execute<{ revoked: boolean }>(
      sql`select revoked_at is not null as revoked from api_tokens where user_id = ${gus.actor.userId}`,
    );
    expect(tokens.rows).toEqual([{ revoked: true }, { revoked: true }]);
    const agents = await adminDb.execute<{ status: string }>(
      sql`select status from agent_identities where id = ${ids.agent}`,
    );
    expect(agents.rows).toEqual([{ status: "revoked" }]);
  });

  it("deletes the person's moment answers and exit reasons", async () => {
    const owner = await person("Owner five");
    const gus = await person("Gus");
    const club = await community(owner, "Weavers");
    await join(club.id, gus);
    await adminDb.execute(sql`
      insert into creator_feedback (id, user_id, community_id, kind, topic, status, score, comment, responded_at)
        values
          (${newId()}, ${gus.actor.userId}, null, 'exit', 'delete_account', 'answered', null, 'Moving on', now()),
          (${newId()}, ${gus.actor.userId}, ${club.id}, 'moment', 'first_post', 'answered', 4, 'Easy', now()),
          (${newId()}, ${owner.actor.userId}, ${club.id}, 'moment', 'first_course', 'pending', null, null, null)`);
    await accountsService.requestDeletion(gus.actor, { confirmation: gus.email });
    clock += (deletionGraceDays + 1) * dayMs;

    expect(await purge.purgeAccount(gus.actor.userId)).toBe("erased");

    const left = await adminDb.execute<{ user_id: string }>(
      sql`select user_id from creator_feedback where community_id = ${club.id} or user_id = ${gus.actor.userId}`,
    );
    expect(left.rows).toEqual([{ user_id: owner.actor.userId }]);
  });

  it("keeps the account for the next run when billing cannot be released", async () => {
    const owner = await person("Owner three");
    const gus = await person("Gus");
    const club = await community(owner, "Paid club");
    await join(club.id, gus);
    await accountsService.requestDeletion(gus.actor, { confirmation: gus.email });
    clock += (deletionGraceDays + 1) * dayMs;
    failBillingFor.add(gus.actor.userId);

    expect(await purge.purgeAccount(gus.actor.userId)).toBe("billing_pending");
    const [held] = await adminDb.select().from(users).where(eq(users.id, gus.actor.userId));
    expect(held).toMatchObject({ name: "Gus", erasedAt: null });

    failBillingFor.delete(gus.actor.userId);
    expect(await purge.purgeAccount(gus.actor.userId)).toBe("erased");
  });

  it("keeps a scheduled purge blocked while an archived community still bills", async () => {
    const owner = await person("Late biller");
    await accountsService.requestDeletion(owner.actor, { confirmation: owner.email });
    const archived = await community(owner, "Still billing");
    await adminDb.execute(
      sql`update communities set archived_at = now() where id = ${archived.id}`,
    );
    billingCommunities.add(archived.id);
    clock += (deletionGraceDays + 1) * dayMs;

    expect(await purge.purgeAccount(owner.actor.userId)).toBe("blocked");

    billingCommunities.delete(archived.id);
    expect(await purge.purgeAccount(owner.actor.userId)).toBe("erased");
  });

  it("holds an account that became an owner during the grace period", async () => {
    const fay = await person("Fay");
    await accountsService.requestDeletion(fay.actor, { confirmation: fay.email });
    await community(fay, "Handed over");
    clock += (deletionGraceDays + 1) * dayMs;

    expect(await purge.purgeAccount(fay.actor.userId)).toBe("blocked");
    const [row] = await adminDb.select().from(users).where(eq(users.id, fay.actor.userId));
    expect(row?.erasedAt).toBeNull();
  });
});

describe("sessions", () => {
  it("lists active sessions with the current one first and revokes one or all others", async () => {
    const gus = await person("Gus");
    const current = await signIn(
      gus,
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36",
    );
    const phone = await signIn(
      gus,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1",
    );
    const laptop = await signIn(gus);

    const listed = await accountsService.listSessions(gus.actor, current);
    expect(listed.map((s) => s.id).sort()).toEqual([current, phone, laptop].sort());
    expect(listed.filter((s) => s.current).map((s) => s.id)).toEqual([current]);
    expect(listed[0]).toMatchObject({ id: current, device: "Chrome on macOS", current: true });
    expect(listed.find((s) => s.id === phone)?.device).toBe("Safari on iPhone");

    expect(await accountsService.revokeSession(gus.actor, phone)).toBe(true);
    expect((await accountsService.listSessions(gus.actor, current)).map((s) => s.id)).not.toContain(
      phone,
    );

    expect(await accountsService.revokeOtherSessions(gus.actor, current)).toBe(1);
    expect((await accountsService.listSessions(gus.actor, current)).map((s) => s.id)).toEqual([
      current,
    ]);
  });

  it("does not revoke or list another member's session", async () => {
    const hal = await person("Hal");
    const ivy = await person("Ivy");
    const ivySession = await signIn(ivy);

    expect(await accountsService.revokeSession(hal.actor, ivySession)).toBe(false);
    expect(await accountsService.listSessions(hal.actor, "none")).toEqual([]);
    expect((await accountsService.listSessions(ivy.actor, ivySession)).map((s) => s.id)).toEqual([
      ivySession,
    ]);
  });
});
