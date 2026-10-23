import { createAgentsService } from "@cohory/agents";
import {
  addMembership,
  communitySlugSchema,
  createCommunity,
  createDb,
  createPool,
  newId,
  parseDatabaseEnv,
  withCommunity,
} from "@cohory/db";
import { users, verifications } from "@cohory/db/schema";
import { devSeed, seedDevData } from "@cohory/db/seed";
import { createLogMailer, type EmailMessage } from "@cohory/email";
import { createRateLimiter, rateLimitDefaults, type RateLimitRules } from "@cohory/rate-limit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth } from "./auth";
import { createAuthOptions } from "./options";

const baseURL = "http://localhost:3000";
const pool = createPool(parseDatabaseEnv().DATABASE_URL);
const db = createDb(pool);
const mailer = createLogMailer({ log: () => undefined });
const agents = createAgentsService({ db });
const authEnv = {
  BETTER_AUTH_SECRET: "integration-secret-that-is-at-least-32-chars",
  BETTER_AUTH_URL: baseURL,
};
const avatarUrlBelongsTo = (userId: string, url: string): boolean =>
  url.startsWith(`${baseURL}/uploads/users/${userId}/avatar.`);
const auth = createAuth(
  createAuthOptions(
    db,
    authEnv,
    mailer,
    { disabled: false },
    { credentials: agents, avatarUrlBelongsTo },
  ),
);

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function post(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function get(pathAndQuery: string): Promise<Response> {
  return auth.handler(new Request(`${baseURL}${pathAndQuery}`, { headers: { origin: baseURL } }));
}

function mailTo(email: string): EmailMessage[] {
  return mailer.sent.filter((message) => message.to === email);
}

function linkIn(message: EmailMessage | undefined): URL {
  const match = message?.text.match(/https?:\/\/\S+/);
  if (!match) {
    throw new Error("No link found in the email");
  }
  return new URL(match[0]);
}

function sessionCookie(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

afterAll(async () => {
  await pool.end();
});

describe("Better Auth against the migrated schema", () => {
  const email = `member-${newId()}@example.test`;
  const password = "correct horse battery staple";

  beforeAll(async () => {
    expect((await post("/sign-up/email", { email, password, name: "Member" })).status).toBe(200);
  });

  it("signs up a user with email and password and assigns a UUIDv7 id", async () => {
    const newEmail = `new-member-${newId()}@example.test`;

    const response = await post("/sign-up/email", {
      email: newEmail,
      password,
      name: "New Member",
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ user: { email: newEmail, name: "New Member" } });
    expect(body).toHaveProperty("user.id", expect.stringMatching(uuidV7));
  });

  it("signs in the same user and issues a session cookie", async () => {
    const response = await post("/sign-in/email", { email, password });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session_token");
  });

  it("rejects a wrong password", async () => {
    const response = await post("/sign-in/email", { email, password: "wrong password here" });

    expect(response.status).toBe(401);
  });

  it("resolves the session through the server API", async () => {
    const result = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    const cookie = result.headers.get("set-cookie") ?? "";

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(session?.user.email).toBe(email);
    expect(session?.session.id).toMatch(uuidV7);
  });

  it("signs in the seeded dev owner with the documented password", async () => {
    await seedDevData(db);

    const response = await post("/sign-in/email", {
      email: devSeed.email,
      password: devSeed.password,
    });

    expect(response.status).toBe(200);
  });
});

describe("sign out and session expiry", () => {
  const email = `session-${newId()}@example.test`;
  const password = "correct horse battery staple";

  beforeAll(async () => {
    expect((await post("/sign-up/email", { email, password, name: "Session" })).status).toBe(200);
  });

  async function signedInSession(): Promise<{ cookie: string; sessionId: string }> {
    const cookie = sessionCookie(await post("/sign-in/email", { email, password }));
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) {
      throw new Error("Sign in did not create a session");
    }
    return { cookie, sessionId: session.session.id };
  }

  async function sessionRows(sessionId: string): Promise<number> {
    const result = await pool.query("select 1 from sessions where id = $1", [sessionId]);
    return result.rowCount ?? 0;
  }

  it("clears the session cookie and deletes the session row on sign out", async () => {
    const { cookie, sessionId } = await signedInSession();

    const response = await post("/sign-out", {}, { cookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/session_token=;.*Max-Age=0/i);
    expect(await sessionRows(sessionId)).toBe(0);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("keeps the person's other sessions when one device signs out", async () => {
    const laptop = await signedInSession();
    const phone = await signedInSession();

    await post("/sign-out", {}, { cookie: laptop.cookie });

    const session = await auth.api.getSession({ headers: new Headers({ cookie: phone.cookie }) });
    expect(session?.session.id).toBe(phone.sessionId);
  });

  it("refuses a session whose expiry has passed", async () => {
    const { cookie, sessionId } = await signedInSession();

    await pool.query("update sessions set expires_at = now() - interval '1 minute' where id = $1", [
      sessionId,
    ]);

    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/get-session`, { headers: { origin: baseURL, cookie } }),
    );
    expect(await response.json()).toBeNull();
  });
});

describe("sign up does not reveal existing accounts", () => {
  const email = `taken-${newId()}@example.test`;
  const password = "correct horse battery staple";

  it("does not sign anyone in from sign up, so a new address gets no session cookie", async () => {
    const response = await post("/sign-up/email", { email, password, name: "First Owner" });

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).not.toContain("session_token");
    expect(await response.json()).toMatchObject({ token: null, user: { email } });
  });

  it("answers an existing address with the same status and shape", async () => {
    const response = await post("/sign-up/email", {
      email,
      password: "another password that is long",
      name: "Someone Else",
    });

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).not.toContain("session_token");
    expect(await response.json()).toMatchObject({ token: null, user: { email } });
  });

  it("emails the owner of the existing address instead of changing the account", async () => {
    const notices = mailTo(email).filter(
      (message) => message.subject === "Someone tried to create an account with your email",
    );
    expect(notices).toHaveLength(1);
    expect(linkIn(notices[0]).pathname).toBe("/sign-in");

    const original = await post("/sign-in/email", { email, password });
    expect(original.status).toBe(200);
  });
});

describe("email verification", () => {
  const email = `verify-${newId()}@example.test`;
  const password = "correct horse battery staple";

  it("sends a verification email through the mailer on sign up", async () => {
    const response = await post("/sign-up/email", {
      email,
      password,
      name: "Verify Me",
      callbackURL: "/",
    });

    expect(response.status).toBe(200);
    const sent = mailTo(email);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Confirm your email address");
    expect(linkIn(sent[0]).pathname).toBe("/api/auth/verify-email");
  });

  it("lets the user sign in before the email is verified while email sending is not configured", async () => {
    const response = await post("/sign-in/email", { email, password });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toHaveProperty("user.emailVerified", false);
  });

  it("marks the email verified when the link is opened", async () => {
    const link = linkIn(mailTo(email)[0]);

    const response = await get(`${link.pathname}${link.search}`);

    expect(response.status).toBe(302);
    const signIn = await post("/sign-in/email", { email, password });
    const body: unknown = await signIn.json();
    expect(body).toHaveProperty("user.emailVerified", true);
  });
});

describe("password reset", () => {
  const email = `reset-${newId()}@example.test`;
  const oldPassword = "correct horse battery staple";
  const newPassword = "a brand new passphrase";
  let token = "";
  let oldSession = "";

  it("emails a reset link that points back to /reset-password", async () => {
    await post("/sign-up/email", { email, password: oldPassword, name: "Reset Me" });
    oldSession = sessionCookie(await post("/sign-in/email", { email, password: oldPassword }));

    const response = await post("/request-password-reset", {
      email,
      redirectTo: "/reset-password",
    });

    expect(response.status).toBe(200);
    const resetMail = mailTo(email).find((m) => m.subject === "Reset your Cohory password");
    const link = linkIn(resetMail);
    expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[A-Za-z0-9]+$/);
    expect(link.searchParams.get("callbackURL")).toBe("/reset-password");

    const callback = await get(`${link.pathname}${link.search}`);
    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get("location") ?? "", baseURL);
    expect(location.pathname).toBe("/reset-password");
    token = location.searchParams.get("token") ?? "";
    expect(token).not.toBe("");
  });

  it("answers the same way for an unknown email and sends nothing", async () => {
    const unknown = `nobody-${newId()}@example.test`;

    const response = await post("/request-password-reset", {
      email: unknown,
      redirectTo: "/reset-password",
    });

    expect(response.status).toBe(200);
    expect(mailTo(unknown)).toHaveLength(0);
  });

  it("sets the new password with the emailed token", async () => {
    const response = await post("/reset-password", { token, newPassword });

    expect(response.status).toBe(200);
    expect((await post("/sign-in/email", { email, password: newPassword })).status).toBe(200);
    expect((await post("/sign-in/email", { email, password: oldPassword })).status).toBe(401);
  });

  it("signs out sessions created before the reset", async () => {
    const session = await auth.api.getSession({ headers: new Headers({ cookie: oldSession }) });

    expect(session).toBeNull();
  });

  it("refuses to reuse the token", async () => {
    const response = await post("/reset-password", {
      token,
      newPassword: "yet another passphrase",
    });

    expect(response.status).toBe(400);
  });

  it("accepts a reset token stored by an import and refuses it once it expired", async () => {
    const [person] = await db
      .insert(users)
      .values({ email: `imported-reset-${newId()}@example.test`, name: "Imported" })
      .returning({ id: users.id });
    if (!person) throw new Error("no user");
    const issue = async (expiresAt: Date) => {
      const issued = newId().replaceAll("-", "");
      await db.insert(verifications).values({
        identifier: `reset-password:${issued}`,
        value: person.id,
        expiresAt,
      });
      return issued;
    };

    const expired = await issue(new Date(Date.now() - 1000));
    expect((await post("/reset-password", { token: expired, newPassword })).status).toBe(400);
    const fresh = await issue(new Date(Date.now() + 60_000));
    expect((await post("/reset-password", { token: fresh, newPassword })).status).toBe(200);
  });
});

describe("account security", () => {
  const email = `security-${newId()}@example.test`;
  const password = "first passphrase for security";

  async function signIn(secret: string): Promise<string> {
    const response = await post("/sign-in/email", { email, password: secret });
    expect(response.status).toBe(200);
    return sessionCookie(response);
  }

  it("revokes every other session when the password changes", async () => {
    expect((await post("/sign-up/email", { email, password, name: "Sec" })).status).toBe(200);
    const laptop = await signIn(password);
    const phone = await signIn(password);

    const changed = await post(
      "/change-password",
      { currentPassword: password, newPassword: "second passphrase for security" },
      { cookie: laptop },
    );
    expect(changed.status).toBe(200);

    expect(await auth.api.getSession({ headers: new Headers({ cookie: phone }) })).toBeNull();
    const newCookie = sessionCookie(changed);
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie: newCookie }) }))?.user.email,
    ).toBe(email);
  });

  it("exposes a scheduled deletion on the session user", async () => {
    const cookie = await signIn("second passphrase for security");
    const before = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(before?.user.deletionScheduledFor ?? null).toBeNull();

    await pool.query(
      "update users set deletion_scheduled_for = now() + interval '14 days' where email = $1",
      [email],
    );
    const after = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(after?.user.deletionScheduledFor).toBeInstanceOf(Date);
  });

  it("does not let a member set the deletion date through update-user", async () => {
    const cookie = await signIn("second passphrase for security");

    const response = await post(
      "/update-user",
      { name: "Sec", deletionScheduledFor: "2020-01-01T00:00:00Z" },
      { cookie },
    );

    expect(response.status).toBe(400);
  });
});

describe("bearer credentials after a password change", () => {
  async function memberWithToken(email: string, password: string): Promise<string> {
    const signedUp = (await (
      await post("/sign-up/email", { email, password, name: "Token holder" })
    ).json()) as { user: { id: string } };
    const community = await createCommunity(db, {
      slug: communitySlugSchema.parse(`pw-${newId().slice(-12)}`),
      name: "Password change",
    });
    await addMembership(withCommunity(db, community.id), {
      userId: signedUp.user.id,
      role: "member",
      status: "active",
    });
    const created = await agents.createPersonalToken(
      { kind: "user", userId: signedUp.user.id, platformAdmin: false },
      { communityId: community.id, name: "Script", scopes: ["posts:read"] },
    );
    expect((await agents.authenticate(created.token)).userId).toBe(signedUp.user.id);
    return created.token;
  }

  it("revokes the person's API tokens when they reset their password", async () => {
    const email = `reset-token-${newId()}@example.test`;
    const token = await memberWithToken(email, "old passphrase for tokens");
    await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    const link = linkIn(mailTo(email).find((m) => m.subject === "Reset your Cohory password"));
    const callback = await get(`${link.pathname}${link.search}`);
    const resetToken =
      new URL(callback.headers.get("location") ?? "", baseURL).searchParams.get("token") ?? "";

    const reset = await post("/reset-password", {
      token: resetToken,
      newPassword: "new passphrase for tokens",
    });

    expect(reset.status).toBe(200);
    await expect(agents.authenticate(token)).rejects.toMatchObject({ reason: "revoked" });
  });

  it("revokes the person's API tokens when they change their password", async () => {
    const email = `change-token-${newId()}@example.test`;
    const token = await memberWithToken(email, "old passphrase for change");
    const cookie = sessionCookie(
      await post("/sign-in/email", { email, password: "old passphrase for change" }),
    );

    const changed = await post(
      "/change-password",
      { currentPassword: "old passphrase for change", newPassword: "new passphrase for change" },
      { cookie },
    );

    expect(changed.status).toBe(200);
    await expect(agents.authenticate(token)).rejects.toMatchObject({ reason: "revoked" });
  });

  it("keeps the tokens when a password change is refused", async () => {
    const email = `refused-token-${newId()}@example.test`;
    const token = await memberWithToken(email, "the right passphrase");
    const cookie = sessionCookie(
      await post("/sign-in/email", { email, password: "the right passphrase" }),
    );

    const refused = await post(
      "/change-password",
      { currentPassword: "a wrong passphrase", newPassword: "another new passphrase" },
      { cookie },
    );

    expect(refused.status).not.toBe(200);
    expect((await agents.authenticate(token)).credential.type).toBe("user");
  });
});

describe("profile rules on update-user", () => {
  const email = `profile-${newId()}@example.test`;
  const password = "profile passphrase that is long";
  let cookie = "";
  let userId = "";

  beforeAll(async () => {
    const signedUp = (await (
      await post("/sign-up/email", { email, password, name: "Profile" })
    ).json()) as { user: { id: string } };
    userId = signedUp.user.id;
    cookie = sessionCookie(await post("/sign-in/email", { email, password }));
  });

  async function storedProfile(): Promise<{ name: string; image: string | null }> {
    const result = await pool.query<{ name: string; image: string | null }>(
      "select name, image from users where id = $1",
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("User row is missing");
    }
    return row;
  }

  it("refuses a name longer than the account form allows", async () => {
    const response = await post("/update-user", { name: "a".repeat(81) }, { cookie });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_NAME" });
    expect((await storedProfile()).name).toBe("Profile");
  });

  it("refuses a blank name", async () => {
    const response = await post("/update-user", { name: "   " }, { cookie });

    expect(response.status).toBe(400);
  });

  it("stores the trimmed name like the account form", async () => {
    const response = await post("/update-user", { name: "  New Name  " }, { cookie });

    expect(response.status).toBe(200);
    expect((await storedProfile()).name).toBe("New Name");
  });

  it("refuses an image that is not the member's own uploaded avatar", async () => {
    for (const image of [
      "https://tracker.example/pixel.png",
      `${baseURL}/uploads/users/${newId()}/avatar.png`,
      "javascript:alert(1)",
    ]) {
      const response = await post("/update-user", { name: "New Name", image }, { cookie });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_IMAGE" });
    }
    expect((await storedProfile()).image).toBeNull();
  });

  it("accepts the member's own uploaded avatar", async () => {
    const image = `${baseURL}/uploads/users/${userId}/avatar.png?v=1`;

    const response = await post("/update-user", { image }, { cookie });

    expect(response.status).toBe(200);
    expect((await storedProfile()).image).toBe(image);
  });

  it("applies the same rules to server calls of updateUser", async () => {
    await expect(
      auth.api.updateUser({
        headers: new Headers({ cookie }),
        body: { image: "https://tracker.example/pixel.png" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("sign in limit per account", () => {
  function limitedAuth(rules: Partial<RateLimitRules> = {}) {
    return createAuth(
      createAuthOptions(db, authEnv, mailer, {
        disabled: false,
        limiter: createRateLimiter({ rules: { ...rateLimitDefaults, ...rules } }),
      }),
    );
  }

  function signInWith(
    instance: ReturnType<typeof limitedAuth>,
  ): (email: string, password: string, ip: string) => Promise<Response> {
    return (email, password, ip) =>
      instance.handler(
        new Request(`${baseURL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": ip },
          body: JSON.stringify({ email, password }),
        }),
      );
  }

  async function account(prefix: string, password: string): Promise<string> {
    const email = `${prefix}-${newId()}@example.test`;
    await post("/sign-up/email", { email, password, name: "Limited" });
    return email;
  }

  it("slows password guessing against one account spread over many addresses", async () => {
    const signIn = signInWith(limitedAuth({ signInAccount: { max: 2, windowSeconds: 60 } }));
    const email = await account("guessed", "the real passphrase");

    expect((await signIn(email, "guess number one", "198.51.100.1")).status).toBe(401);
    expect((await signIn(email.toUpperCase(), "guess number two", "198.51.100.2")).status).toBe(
      401,
    );
    const refused = await signIn(` ${email} `, "the real passphrase", "198.51.100.3");

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("does not count successful sign ins", async () => {
    const signIn = signInWith(limitedAuth({ signInAccount: { max: 2, windowSeconds: 60 } }));
    const password = "frequent passphrase";
    const email = await account("frequent", password);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await signIn(email, password, "198.51.100.9")).status).toBe(200);
    }
  });

  it("lets the person sign in after a burst of failures that stays under the address limit", async () => {
    const signIn = signInWith(limitedAuth());
    const password = "victim passphrase";
    const email = await account("victim", password);

    for (let attempt = 0; attempt < rateLimitDefaults.signIn.max; attempt += 1) {
      expect((await signIn(email, `wrong guess ${attempt}`, "203.0.113.66")).status).toBe(401);
    }

    expect((await signIn(email, password, "198.51.100.10")).status).toBe(200);
  });

  it("keeps other accounts usable from the same addresses", async () => {
    const signIn = signInWith(limitedAuth({ signInAccount: { max: 1, windowSeconds: 60 } }));
    const target = await account("target", "target passphrase");
    await signIn(target, "wrong guess", "198.51.100.1");
    const password = "bystander passphrase";
    const email = await account("bystander", password);

    expect((await signIn(email, password, "198.51.100.1")).status).toBe(200);
  });
});

describe("profile rules on sign up", () => {
  it("refuses a name longer than the account form allows", async () => {
    const email = `long-name-${newId()}@example.test`;

    const response = await post("/sign-up/email", {
      email,
      password: "long name passphrase",
      name: "a".repeat(81),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_NAME" });
    expect((await pool.query("select 1 from users where email = $1", [email])).rowCount).toBe(0);
  });

  it("refuses an image on sign up", async () => {
    const email = `image-${newId()}@example.test`;

    const response = await post("/sign-up/email", {
      email,
      password: "image passphrase here",
      name: "Image",
      image: "https://tracker.example/pixel.png",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_IMAGE" });
    expect((await pool.query("select 1 from users where email = $1", [email])).rowCount).toBe(0);
  });

  it("stores the trimmed name", async () => {
    const email = `trimmed-${newId()}@example.test`;

    const response = await post("/sign-up/email", {
      email,
      password: "trimmed passphrase",
      name: "  Trimmed Name  ",
    });

    expect(response.status).toBe(200);
    const stored = await pool.query<{ name: string }>("select name from users where email = $1", [
      email,
    ]);
    expect(stored.rows[0]?.name).toBe("Trimmed Name");
  });
});

describe("client address", () => {
  it("records the address the proxy appended, like the app limiter", async () => {
    const email = `address-${newId()}@example.test`;
    const password = "address passphrase";
    await post("/sign-up/email", { email, password, name: "Address" });

    const cookie = sessionCookie(
      await post(
        "/sign-in/email",
        { email, password },
        { "x-forwarded-for": "10.9.8.7, 203.0.113.9" },
      ),
    );
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(session?.session.ipAddress).toBe("203.0.113.9");
  });
});
