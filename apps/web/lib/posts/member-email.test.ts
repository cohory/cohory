import { ForbiddenError } from "@cohory/authz";
import { describe, expect, it, vi } from "vitest";

import { emailMembersSafely, MEMBER_EMAIL_FAILED } from "./member-email";

const ids = {
  communityId: "0192f2a4-0000-7000-8000-000000000001",
  postId: "0192f2a4-0000-7000-8000-000000000002",
};

describe("emailMembersSafely", () => {
  it("returns no failure when the email goes out", async () => {
    const log = vi.fn();

    await expect(emailMembersSafely(async () => undefined, ids, log)).resolves.toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("returns the plain message of a known refusal", async () => {
    const log = vi.fn();
    const message = await emailMembersSafely(
      async () => {
        throw new ForbiddenError("email", "community");
      },
      ids,
      log,
    );

    expect(message).toEqual(expect.any(String));
    expect(message).not.toBe(MEMBER_EMAIL_FAILED);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps the post when the email breaks unexpectedly, and logs only ids", async () => {
    const log = vi.fn();
    const message = await emailMembersSafely(
      async () => {
        throw new Error("queue down at secret-host");
      },
      ids,
      log,
    );

    expect(message).toBe(MEMBER_EMAIL_FAILED);
    expect(log).toHaveBeenCalledExactlyOnceWith("member email failed", {
      ...ids,
      error: "Error",
    });
  });
});
