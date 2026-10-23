import { afterEach, describe, expect, it, vi } from "vitest";

import { authLogger, redactEmails, verificationRequest } from "./account-emails";

function token(claims: Record<string, string>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authLogger", () => {
  it("keeps Better Auth's informational messages out of the logs", () => {
    expect(authLogger.level).toBe("warn");
  });

  it("removes email addresses from a message and its arguments", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);

    authLogger.log("info", "Sign-up attempt for existing email: ada@example.com", "bo@example.com");

    const line: unknown = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: "info",
      source: "better-auth",
      msg: "Sign-up attempt for existing email: [email]",
      details: ["[email]"],
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("example.com");
  });

  it("redacts every address in a line", () => {
    expect(redactEmails("from a.b+c@example.com to <d@example.org>")).toBe(
      "from [email] to <[email]>",
    );
  });
});

describe("verificationRequest", () => {
  it("reads a change of address from the token", () => {
    expect(
      verificationRequest(token({ email: "old@example.com", updateTo: "new@example.com" })),
    ).toEqual({ kind: "change", from: "old@example.com", to: "new@example.com" });
  });

  it("treats anything else as a plain confirmation", () => {
    expect(verificationRequest(token({ email: "ada@example.com" }))).toEqual({ kind: "confirm" });
    expect(verificationRequest("not a token")).toEqual({ kind: "confirm" });
    expect(verificationRequest(undefined)).toEqual({ kind: "confirm" });
  });
});
