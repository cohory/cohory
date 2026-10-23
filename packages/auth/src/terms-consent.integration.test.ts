import { users } from "@cohory/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createAuth } from "./auth";
import { createAuthOptions } from "./options";
import { address, authEnv, db, mailer, pool, post } from "./test/account-flow";

afterAll(async () => {
  await pool.end();
});

function authWithTerms(termsVersion: string | null) {
  return createAuth(createAuthOptions(db, authEnv, mailer, { disabled: true }, { termsVersion }));
}

async function signUp(instance: ReturnType<typeof authWithTerms>, body: Record<string, string>) {
  const response = await post("/sign-up/email", body, {}, instance);
  expect(response.status).toBe(200);
  const [row] = await db
    .select({ termsVersion: users.termsVersion, termsAcceptedAt: users.termsAcceptedAt })
    .from(users)
    .where(eq(users.email, body["email"] ?? ""));
  return row;
}

describe("terms consent at sign up", () => {
  it("records the Terms version and the time the person accepted it", async () => {
    const before = Date.now();
    const row = await signUp(authWithTerms("2026-10"), {
      name: "Consenting Member",
      email: address("terms"),
      password: "correct horse battery staple",
    });
    expect(row?.termsVersion).toBe("2026-10");
    expect(row?.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("records nothing when the server shows no Terms to agree to", async () => {
    const row = await signUp(authWithTerms(null), {
      name: "Self Hosted Member",
      email: address("no-terms"),
      password: "correct horse battery staple",
    });
    expect(row).toEqual({ termsVersion: null, termsAcceptedAt: null });
  });

  it("refuses a Terms version sent by the client", async () => {
    const email = address("forged-terms");
    const response = await post(
      "/sign-up/email",
      {
        name: "Forging Member",
        email,
        password: "correct horse battery staple",
        termsVersion: "x",
      },
      {},
      authWithTerms(null),
    );
    expect(response.status).toBe(400);
    expect(await db.select().from(users).where(eq(users.email, email))).toEqual([]);
  });
});
