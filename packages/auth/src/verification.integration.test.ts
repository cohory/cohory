import { createRateLimiter, rateLimitDefaults } from "@cohory/rate-limit";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { markUnverifiedAccountsVerified, summarizeUnverifiedAccounts } from "./accounts";
import { createAuth } from "./auth";
import { createAuthOptions } from "./options";
import {
  address,
  auth,
  baseURL,
  authEnv,
  buildAuth,
  db,
  linkIn,
  location,
  mailer,
  mailTo,
  open,
  pool,
  post,
  sessionCookie,
  signUp,
  verifiedMember,
} from "./test/account-flow";

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

describe("sign up and sign in when email sending is configured", () => {
  const password = "correct horse battery staple";

  it("refuses to sign in an account whose email is not confirmed yet", async () => {
    const email = address("unverified");
    await signUp(email, password);

    const response = await post("/sign-in/email", { email, password });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(sessionCookie(response)).toBe("");
  });

  it("still answers a wrong password with the generic error, so the state is not revealed", async () => {
    const email = address("wrong-password");
    await signUp(email, password);

    const response = await post("/sign-in/email", { email, password: "not the password" });

    expect(response.status).toBe(401);
  });

  it("confirms the email from the link, sends the person to /verified, and does not sign the clicker in", async () => {
    const email = address("confirm");
    await signUp(email, password, "/c/design/about");
    const link = linkIn(mailTo(email, "Confirm your email address")[0]);

    const response = await open(link);

    expect(response.status).toBe(302);
    const target = location(response);
    expect(target.pathname).toBe("/verified");
    expect(target.searchParams.get("next")).toBe("/c/design/about");
    expect(target.searchParams.get("error")).toBeNull();
    expect(sessionCookie(response)).toBe("");
    expect((await post("/sign-in/email", { email, password })).status).toBe(200);
  });

  it("signs out the confirmed member", async () => {
    const email = address("sign-out");
    const cookie = await verifiedMember(email, password);

    const response = await post("/sign-out", {}, { cookie });

    expect(response.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("says the link expired after an hour", async () => {
    const email = address("expired");
    await signUp(email, password);
    const link = linkIn(mailTo(email, "Confirm your email address")[0]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61 * 60 * 1000 });

    const response = await open(link);

    vi.useRealTimers();
    const target = location(response);
    expect(target.pathname).toBe("/verified");
    expect(target.searchParams.get("error")).toBe("TOKEN_EXPIRED");
    expect((await post("/sign-in/email", { email, password })).status).toBe(403);
  });

  it("sends a new link on request, and the new link confirms the email", async () => {
    const email = address("resend");
    await signUp(email, password);

    const response = await post("/send-verification-email", { email, callbackURL: "/account" });

    expect(response.status).toBe(200);
    const links = mailTo(email, "Confirm your email address");
    expect(links).toHaveLength(2);
    const fresh = linkIn(links[1]);
    expect(new URL(fresh.searchParams.get("callbackURL") ?? "", baseURL).pathname).toBe(
      "/verified",
    );
    expect((await open(fresh)).status).toBe(302);
    expect((await post("/sign-in/email", { email, password })).status).toBe(200);
  });

  it("answers a resend for an unknown address the same way and sends nothing", async () => {
    const email = address("nobody");

    const response = await post("/send-verification-email", { email });

    expect(response.status).toBe(200);
    expect(mailTo(email)).toHaveLength(0);
  });

  it("limits how often one address can ask for a new link", async () => {
    const limited = buildAuth(
      createRateLimiter({
        rules: { ...rateLimitDefaults, passwordReset: { max: 2, windowSeconds: 600 } },
      }),
    );
    const email = address("resend-limit");
    await signUp(email, password);
    const resend = (ip: string) =>
      post("/send-verification-email", { email }, { "x-forwarded-for": ip }, limited);

    expect((await resend("198.51.100.1")).status).toBe(200);
    expect((await resend("198.51.100.2")).status).toBe(200);
    const refused = await resend("198.51.100.3");

    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("emails the owner of a taken address with a sign in link first and the reset second", async () => {
    const email = address("taken");
    await signUp(email, password);

    await post("/sign-up/email", { email, password: "someone else entirely", name: "Other" });

    const notice = mailTo(email, "Someone tried to create an account with your email")[0];
    expect(linkIn(notice).pathname).toBe("/sign-in");
    expect(notice?.text).toContain(`${baseURL}/forgot-password`);
  });
});

describe("account pre hijacking", () => {
  const attackerPassword = "attacker knows this one";

  it("keeps an account someone else created for my address locked until I prove the mailbox", async () => {
    const email = address("victim-locked");
    await signUp(email, attackerPassword);

    expect((await post("/sign-in/email", { email, password: attackerPassword })).status).toBe(403);
  });

  it("removes the attacker's password when the owner signs in with a magic link", async () => {
    const email = address("victim-magic");
    await signUp(email, attackerPassword);

    expect((await post("/sign-in/magic-link", { email, callbackURL: "/" })).status).toBe(200);
    const signedIn = await open(linkIn(mailTo(email, "Your Cohory sign in link")[0]));

    expect(sessionCookie(signedIn)).not.toBe("");
    expect((await post("/sign-in/email", { email, password: attackerPassword })).status).toBe(401);
  });

  it("replaces the attacker's password and confirms the email when the owner resets it", async () => {
    const email = address("victim-reset");
    const ownerPassword = "the real owner chose this";
    await signUp(email, attackerPassword);

    await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    const callback = await open(linkIn(mailTo(email, "Reset your Cohory password")[0]));
    const token = location(callback).searchParams.get("token") ?? "";
    expect((await post("/reset-password", { token, newPassword: ownerPassword })).status).toBe(200);

    expect((await post("/sign-in/email", { email, password: attackerPassword })).status).toBe(401);
    expect((await post("/sign-in/email", { email, password: ownerPassword })).status).toBe(200);
  });
});

describe("magic link sign in", () => {
  it("emails a link that works once and signs the member in", async () => {
    const email = address("magic");
    await verifiedMember(email, "magic member passphrase");

    const response = await post("/sign-in/magic-link", { email, callbackURL: "/c/design" });

    expect(response.status).toBe(200);
    const link = linkIn(mailTo(email, "Your Cohory sign in link")[0]);
    const first = await open(link);
    expect(location(first).pathname).toBe("/c/design");
    expect(sessionCookie(first)).not.toBe("");

    const again = await open(link);
    expect(location(again).pathname).toBe("/sign-in");
    expect(location(again).searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(location(again).searchParams.get("next")).toBe("/c/design");
  });

  it("stops working after 15 minutes", async () => {
    const email = address("magic-expired");
    await verifiedMember(email, "magic member passphrase");
    await post("/sign-in/magic-link", { email });
    const link = linkIn(mailTo(email, "Your Cohory sign in link")[0]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 16 * 60 * 1000 });

    const response = await open(link);

    vi.useRealTimers();
    expect(location(response).searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(sessionCookie(response)).toBe("");
  });

  it("answers an unknown address the same way without creating an account or sending email", async () => {
    const email = address("magic-nobody");

    const response = await post("/sign-in/magic-link", { email });

    expect(response.status).toBe(200);
    expect(mailTo(email)).toHaveLength(0);
    expect((await pool.query("select 1 from users where email = $1", [email])).rowCount).toBe(0);
  });

  it("is not offered when email sending is not configured", async () => {
    const withoutEmail = createAuth(createAuthOptions(db, authEnv, mailer));
    const email = address("magic-off");

    const response = await post("/sign-in/magic-link", { email }, {}, withoutEmail);

    expect(response.status).toBe(404);
    expect(mailTo(email)).toHaveLength(0);
  });
});

describe("changing the email address", () => {
  const password = "change email passphrase";

  it("confirms the new address, warns the old one, and moves the account after the click", async () => {
    const oldEmail = address("old");
    const newEmail = address("new");
    const cookie = await verifiedMember(oldEmail, password);

    const response = await post("/change-email", { newEmail }, { cookie });

    expect(response.status).toBe(200);
    expect(mailTo(newEmail)).toHaveLength(0);
    const approval = mailTo(oldEmail, "Approve your new Cohory email address")[0];
    expect(approval?.text).toContain(newEmail);
    const approved = await open(linkIn(approval), cookie);
    expect(location(approved).pathname).toBe("/verified");
    expect(mailTo(oldEmail, "Your Cohory email is changing")).toHaveLength(0);
    const confirm = mailTo(newEmail, "Confirm your new email address")[0];
    expect(confirm).toBeDefined();
    const opened = await open(linkIn(confirm), cookie);
    expect(location(opened).pathname).toBe("/verified");
    expect(location(opened).searchParams.get("error")).toBeNull();
    expect((await post("/sign-in/email", { email: newEmail, password })).status).toBe(200);
    expect((await post("/sign-in/email", { email: oldEmail, password })).status).toBe(401);
  });

  it("keeps the old address until the new one is confirmed", async () => {
    const oldEmail = address("old-pending");
    const newEmail = address("new-pending");
    const cookie = await verifiedMember(oldEmail, password);

    await post("/change-email", { newEmail }, { cookie });

    expect((await post("/sign-in/email", { email: oldEmail, password })).status).toBe(200);
  });

  it("does not reveal that the new address already has an account", async () => {
    const taken = address("taken-target");
    await verifiedMember(taken, password);
    const cookie = await verifiedMember(address("mover"), password);

    const response = await post("/change-email", { newEmail: taken }, { cookie });

    expect(response.status).toBe(200);
    expect(mailTo(taken, "Confirm your new email address")).toHaveLength(0);
  });
});

describe("password changed email", () => {
  const password = "first passphrase here";

  it("tells the member when the password was changed from the account page", async () => {
    const email = address("changed");
    const cookie = await verifiedMember(email, password);

    const response = await post(
      "/change-password",
      { currentPassword: password, newPassword: "second passphrase here" },
      {
        cookie,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
      },
    );

    expect(response.status).toBe(200);
    const notice = mailTo(email, "Your Cohory password was changed")[0];
    expect(notice?.text).toContain("Firefox on macOS");
    expect(linkIn(notice).pathname).toBe("/forgot-password");
  });

  it("does not send it when the change is refused", async () => {
    const email = address("changed-refused");
    const cookie = await verifiedMember(email, password);

    await post(
      "/change-password",
      { currentPassword: "wrong passphrase", newPassword: "second passphrase here" },
      { cookie },
    );

    expect(mailTo(email, "Your Cohory password was changed")).toHaveLength(0);
  });

  it("tells the member after a password reset", async () => {
    const email = address("reset-notice");
    await verifiedMember(email, password);
    await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    const callback = await open(linkIn(mailTo(email, "Reset your Cohory password")[0]));
    const token = location(callback).searchParams.get("token") ?? "";

    await post("/reset-password", { token, newPassword: "reset passphrase here" });

    expect(mailTo(email, "Your Cohory password was changed")).toHaveLength(1);
  });
});

describe("accounts created before verification was required", () => {
  it("marks unverified accounts created before the cutoff as verified, and only those", async () => {
    const before = address("legacy");
    const password = "legacy member passphrase";
    await signUp(before, password);
    await pool.query("update users set created_at = now() - interval '1 day' where email = $1", [
      before,
    ]);
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const after = address("after-cutoff");
    await signUp(after, password);

    const preview = await summarizeUnverifiedAccounts(db, cutoff);
    expect(preview.count).toBeGreaterThanOrEqual(1);
    expect((await post("/sign-in/email", { email: before, password })).status).toBe(403);

    const marked = await markUnverifiedAccountsVerified(db, cutoff);

    expect(marked.count).toBe(preview.count);
    expect(marked.earliestCreatedAt?.getTime()).toBe(preview.earliestCreatedAt?.getTime());
    expect(marked.latestCreatedAt?.getTime()).toBe(preview.latestCreatedAt?.getTime());
    expect(marked.latestCreatedAt?.getTime()).toBeLessThan(cutoff.getTime());
    expect((await post("/sign-in/email", { email: before, password })).status).toBe(200);
    expect((await post("/sign-in/email", { email: after, password })).status).toBe(403);
    const audit = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "select a.action, a.metadata from account_audit_log a join users u on u.id = a.user_id where u.email = $1",
      [before],
    );
    expect(audit.rows).toEqual([
      {
        action: "account.email_marked_verified",
        metadata: { via: "accounts-cli", createdBefore: cutoff.toISOString() },
      },
    ]);
    expect((await summarizeUnverifiedAccounts(db, cutoff)).count).toBe(0);
  });
});
