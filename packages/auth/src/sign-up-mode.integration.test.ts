import { users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createAuth } from "./auth";
import { createAuthOptions } from "./options";
import { signUpGate, type SignUpLookups } from "./sign-up-gate";
import { address, authEnv, db, mailer, pool, post } from "./test/account-flow";

afterAll(async () => {
  await pool.end();
});

const token = "B".repeat(43);

const expiredToken = "C".repeat(43);

const lookups: SignUpLookups = {
  inviteActive: async (candidate) => candidate === token,
};

function authFor(mode: "open" | "invite" | "closed") {
  return createAuth(
    createAuthOptions(
      db,
      authEnv,
      mailer,
      { disabled: true },
      { signUpAllowed: signUpGate(mode, lookups) },
    ),
  );
}

async function signUp(instance: ReturnType<typeof authFor>, callbackURL: string) {
  const email = address("sign-up-mode");
  const response = await post(
    "/sign-up/email",
    { name: "New Member", email, password: "correct horse battery staple", callbackURL },
    {},
    instance,
  );
  const created = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { response, created: created.length > 0 };
}

describe("sign up mode", () => {
  it("refuses a sign up on the server when sign up is closed, without creating the account", async () => {
    const { response, created } = await signUp(authFor("closed"), `/join/${token}?accept=1`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "SIGN_UP_CLOSED" });
    expect(created).toBe(false);
  });

  it("refuses a sign up without an invite when sign up is by invite", async () => {
    const { response, created } = await signUp(authFor("invite"), "/");
    expect(response.status).toBe(403);
    expect(created).toBe(false);
  });

  it("refuses a join from any community page alike when sign up is by invite", async () => {
    const refusals = [];
    for (const callbackURL of [
      "/c/public-makers/join?intent=join",
      "/c/private-studio/join?intent=request",
      "/c/no-such-community/join?intent=checkout",
      "/",
    ]) {
      const { response, created } = await signUp(authFor("invite"), callbackURL);
      expect(created).toBe(false);
      refusals.push({ status: response.status, body: await response.json() });
    }
    expect(refusals[0]).toEqual({
      status: 403,
      body: expect.objectContaining({ code: "SIGN_UP_CLOSED" }),
    });
    expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
  });

  it("refuses an expired or used up invite when sign up is by invite", async () => {
    const { response, created } = await signUp(authFor("invite"), `/join/${expiredToken}?accept=1`);
    expect(response.status).toBe(403);
    expect(created).toBe(false);
  });

  it("creates the account when the sign up continues an active invite", async () => {
    const { response, created } = await signUp(authFor("invite"), `/join/${token}?accept=1`);
    expect(response.status).toBe(200);
    expect(created).toBe(true);
  });

  it("creates the account when sign up is open", async () => {
    const { response, created } = await signUp(authFor("open"), "/");
    expect(response.status).toBe(200);
    expect(created).toBe(true);
  });
});
