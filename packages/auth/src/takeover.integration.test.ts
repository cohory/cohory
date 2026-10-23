import { afterAll, describe, expect, it } from "vitest";

import {
  address,
  linkIn,
  location,
  mailTo,
  open,
  pool,
  post,
  revokedCredentials,
  sessionCookie,
  signedIn,
  signUp,
  verifiedMember,
} from "./test/account-flow";

const removedSubject = "We removed the password on your Cohory account";

afterAll(async () => {
  await pool.end();
});

async function userId(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>("select id from users where email = $1", [email]);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("No user for that email");
  }
  return id;
}

async function markers(id: string): Promise<number> {
  const result = await pool.query("select 1 from verifications where identifier = $1", [
    `unproven-password:${id}`,
  ]);
  return result.rowCount ?? 0;
}

async function confirmFromMailbox(email: string): Promise<void> {
  const response = await open(linkIn(mailTo(email, "Confirm your email address")[0]));
  expect(location(response).searchParams.get("error")).toBeNull();
}

async function signInWithMagicLink(email: string): Promise<string> {
  expect((await post("/sign-in/magic-link", { email, callbackURL: "/" })).status).toBe(200);
  const links = mailTo(email, "Your Cohory sign in link");
  const response = await open(linkIn(links[links.length - 1]));
  const cookie = sessionCookie(response);
  expect(cookie).not.toBe("");
  return cookie;
}

async function resetPassword(email: string, newPassword: string): Promise<void> {
  await post("/request-password-reset", { email, redirectTo: "/reset-password" });
  const callback = await open(linkIn(mailTo(email, "Reset your Cohory password")[0]));
  const token = location(callback).searchParams.get("token") ?? "";
  expect((await post("/reset-password", { token, newPassword })).status).toBe(200);
}

describe("a password set before the email was confirmed", () => {
  const attackerPassword = "attacker knows this one";

  it("is removed, with the attacker's sessions, when the owner confirms and then signs in with a magic link", async () => {
    const email = address("hijack");
    await signUp(email, attackerPassword);
    await confirmFromMailbox(email);
    const attacker = await post("/sign-in/email", { email, password: attackerPassword });
    expect(attacker.status).toBe(200);
    const attackerCookie = sessionCookie(attacker);
    const id = await userId(email);
    expect(await markers(id)).toBe(1);

    const ownerCookie = await signInWithMagicLink(email);

    expect((await post("/sign-in/email", { email, password: attackerPassword })).status).toBe(401);
    expect(await signedIn(attackerCookie)).toBe(false);
    expect(await signedIn(ownerCookie)).toBe(true);
    expect(revokedCredentials).toContain(id);
    expect(await markers(id)).toBe(0);
    const notice = mailTo(email, removedSubject);
    expect(notice).toHaveLength(1);
    expect(notice[0]?.text).toContain(
      "For your security we removed the password on this account, because it was set before your email was confirmed. If you set it, choose a new one from Account, Security.",
    );
  });

  it("is still removed when someone changed it from the account page after the confirmation", async () => {
    const email = address("hijack-changed");
    const changedPassword = "attacker changed it again";
    await signUp(email, attackerPassword);
    await confirmFromMailbox(email);
    const attackerCookie = sessionCookie(
      await post("/sign-in/email", { email, password: attackerPassword }),
    );
    const changed = await post(
      "/change-password",
      { currentPassword: attackerPassword, newPassword: changedPassword },
      { cookie: attackerCookie },
    );
    expect(changed.status).toBe(200);

    await signInWithMagicLink(email);

    expect((await post("/sign-in/email", { email, password: changedPassword })).status).toBe(401);
    expect(mailTo(email, removedSubject)).toHaveLength(1);
  });

  it("is kept once a password reset proved the mailbox", async () => {
    const email = address("reset-kept");
    const ownerPassword = "the owner picked this";
    await signUp(email, attackerPassword);
    await confirmFromMailbox(email);
    await resetPassword(email, ownerPassword);
    expect(await markers(await userId(email))).toBe(0);

    await signInWithMagicLink(email);

    expect((await post("/sign-in/email", { email, password: ownerPassword })).status).toBe(200);
    expect(mailTo(email, removedSubject)).toHaveLength(0);
  });

  it("leaves the password alone for a magic link sign in when no marker exists", async () => {
    const email = address("no-marker");
    const password = "member passphrase here";
    await verifiedMember(email, password);
    await pool.query("delete from verifications where identifier = $1", [
      `unproven-password:${await userId(email)}`,
    ]);

    await signInWithMagicLink(email);

    expect((await post("/sign-in/email", { email, password })).status).toBe(200);
    expect(mailTo(email, removedSubject)).toHaveLength(0);
  });
});

describe("a confirmed change of email address", () => {
  const password = "moving member passphrase";

  it("signs out every other device and revokes API credentials", async () => {
    const oldEmail = address("move-old");
    const newEmail = address("move-new");
    const here = await verifiedMember(oldEmail, password);
    const elsewhere = sessionCookie(await post("/sign-in/email", { email: oldEmail, password }));
    const id = await userId(oldEmail);

    await post("/change-email", { newEmail }, { cookie: here });
    await open(linkIn(mailTo(oldEmail, "Approve your new Cohory email address")[0]), here);
    const confirmed = await open(
      linkIn(mailTo(newEmail, "Confirm your new email address")[0]),
      here,
    );

    expect(location(confirmed).searchParams.get("error")).toBeNull();
    expect(await signedIn(here)).toBe(true);
    expect(await signedIn(elsewhere)).toBe(false);
    expect(revokedCredentials).toContain(id);
  });

  it("is refused while the current address is not confirmed, so the old mailbox always approves", async () => {
    const oldEmail = address("unconfirmed-mover");
    const newEmail = address("unconfirmed-target");
    const cookie = await verifiedMember(oldEmail, password);
    await pool.query("update users set email_verified = false where email = $1", [oldEmail]);

    const response = await post("/change-email", { newEmail }, { cookie });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(mailTo(newEmail)).toHaveLength(0);
  });

  it("does not move the account when only the new address confirms", async () => {
    const oldEmail = address("unapproved-old");
    const newEmail = address("unapproved-new");
    const cookie = await verifiedMember(oldEmail, password);

    await post("/change-email", { newEmail }, { cookie });

    expect(mailTo(newEmail)).toHaveLength(0);
    expect((await post("/sign-in/email", { email: oldEmail, password })).status).toBe(200);
  });
});
