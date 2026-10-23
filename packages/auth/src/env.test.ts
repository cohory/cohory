import { describe, expect, it } from "vitest";

import { parseAuthEnv } from "./env";

const strongSecret = "q8Vt2nR4xL7pK1sW9mZ3cB6yH0jF5gD2aN8eU4iO7wQ=";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: strongSecret,
    BETTER_AUTH_URL: "https://community.example.com",
    ...overrides,
  };
}

describe("parseAuthEnv", () => {
  it("accepts a random secret and an https URL in production", () => {
    expect(parseAuthEnv(env({}))).toMatchObject({
      BETTER_AUTH_SECRET: strongSecret,
      BETTER_AUTH_URL: "https://community.example.com",
    });
  });

  it("refuses the placeholder secret from .env.example in production", () => {
    expect(() =>
      parseAuthEnv(env({ BETTER_AUTH_SECRET: "change-me-to-a-random-string-of-32-characters" })),
    ).toThrow(/placeholder/);
  });

  it("refuses a low entropy secret in production", () => {
    expect(() => parseAuthEnv(env({ BETTER_AUTH_SECRET: "ab".repeat(24) }))).toThrow(/random/);
  });

  it("keeps the placeholder usable outside production", () => {
    const parsed = parseAuthEnv(
      env({
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: "change-me-to-a-random-string-of-32-characters",
      }),
    );

    expect(parsed.BETTER_AUTH_SECRET).toBe("change-me-to-a-random-string-of-32-characters");
  });

  it("keeps the placeholder usable for a production build served on localhost", () => {
    const parsed = parseAuthEnv(
      env({
        BETTER_AUTH_SECRET: "change-me-to-a-random-string-of-32-characters",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    );

    expect(parsed.BETTER_AUTH_SECRET).toBe("change-me-to-a-random-string-of-32-characters");
  });

  it("refuses a secret shorter than 32 characters everywhere", () => {
    expect(() =>
      parseAuthEnv(env({ NODE_ENV: "development", BETTER_AUTH_SECRET: "too-short" })),
    ).toThrow();
  });

  it("refuses a plain http URL in production so cookies always get Secure", () => {
    expect(() => parseAuthEnv(env({ BETTER_AUTH_URL: "http://community.example.com" }))).toThrow(
      /https/,
    );
  });

  it("allows http on a private host in production only with ALLOW_INSECURE_HTTP=true", () => {
    const lan = env({ BETTER_AUTH_URL: "http://cohory.tail1234.ts.net" });

    expect(() => parseAuthEnv({ ...lan, ALLOW_INSECURE_HTTP: "false" })).toThrow(/https/);
    expect(parseAuthEnv({ ...lan, ALLOW_INSECURE_HTTP: "true" }).BETTER_AUTH_URL).toBe(
      "http://cohory.tail1234.ts.net",
    );
  });

  it("refuses an ALLOW_INSECURE_HTTP value other than true or false", () => {
    expect(() => parseAuthEnv(env({ ALLOW_INSECURE_HTTP: "yes" }))).toThrow();
  });

  it("allows http on localhost in production for local stacks and e2e", () => {
    for (const url of ["http://localhost:3310", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      expect(parseAuthEnv(env({ BETTER_AUTH_URL: url })).BETTER_AUTH_URL).toBe(url);
    }
  });

  it("allows http on any host outside production", () => {
    const parsed = parseAuthEnv(
      env({ NODE_ENV: "development", BETTER_AUTH_URL: "http://192.168.1.20:3000" }),
    );

    expect(parsed.BETTER_AUTH_URL).toBe("http://192.168.1.20:3000");
  });

  it("parses versioned secrets with the current version first", () => {
    const older = "Z7mP3kW9qT1vB5nR8xC2hL6dF0sG4jY=";
    const parsed = parseAuthEnv(env({ BETTER_AUTH_SECRETS: `2:${strongSecret}, 1:${older}` }));

    expect(parsed.BETTER_AUTH_SECRETS).toEqual([
      { version: 2, value: strongSecret },
      { version: 1, value: older },
    ]);
  });

  it("leaves versioned secrets unset when the variable is empty", () => {
    expect(parseAuthEnv(env({ BETTER_AUTH_SECRETS: "" })).BETTER_AUTH_SECRETS).toBeUndefined();
  });

  it("refuses malformed or duplicate versioned secrets", () => {
    expect(() => parseAuthEnv(env({ BETTER_AUTH_SECRETS: strongSecret }))).toThrow();
    expect(() =>
      parseAuthEnv(env({ BETTER_AUTH_SECRETS: `1:${strongSecret},1:${strongSecret}` })),
    ).toThrow(/once/);
  });

  it("applies the production secret rules to every versioned secret", () => {
    expect(() =>
      parseAuthEnv(env({ BETTER_AUTH_SECRETS: `2:${strongSecret},1:${"ab".repeat(24)}` })),
    ).toThrow(/random/);
  });

  it("refuses a versioned secret shorter than 32 characters everywhere", () => {
    expect(() =>
      parseAuthEnv(
        env({ NODE_ENV: "development", BETTER_AUTH_SECRETS: `2:${strongSecret},1:short` }),
      ),
    ).toThrow(/32/);
  });

  it("applies the production secret rules to the current versioned secret", () => {
    expect(() =>
      parseAuthEnv(env({ BETTER_AUTH_SECRETS: "3:change-me-to-a-random-string-of-32-characters" })),
    ).toThrow(/placeholder/);
  });
});
