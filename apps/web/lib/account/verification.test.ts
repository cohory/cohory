import { RateLimitedError } from "@cohory/rate-limit";
import { describe, expect, it, vi } from "vitest";

import { resendVerification } from "./verification";

const user = { id: "019a0000-0000-7000-8000-000000000001", email: "ada@example.test" };

describe("resendVerification", () => {
  it("sends a new confirmation link to the signed in address", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const consume = vi.fn();

    const state = await resendVerification({ ...user, emailVerified: false }, { send, consume });

    expect(consume).toHaveBeenCalledWith(user.id);
    expect(send).toHaveBeenCalledWith(user.email);
    expect(state).toEqual({
      status: "sent",
      message: "We sent a new link to ada@example.test. It may take a minute to arrive.",
    });
  });

  it("does nothing when the address is already confirmed", async () => {
    const send = vi.fn();
    const consume = vi.fn();

    const state = await resendVerification({ ...user, emailVerified: true }, { send, consume });

    expect(send).not.toHaveBeenCalled();
    expect(state).toEqual({ status: "verified", message: "Your email is already confirmed." });
  });

  it("asks the person to wait when they resend too often", async () => {
    const send = vi.fn();
    const consume = vi.fn(() => {
      throw new RateLimitedError("passwordReset", 120);
    });

    const state = await resendVerification({ ...user, emailVerified: false }, { send, consume });

    expect(send).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: "error",
      message: "You asked for several links already. Wait a few minutes and try again.",
    });
  });

  it("says plainly when the email could not be sent", async () => {
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));

    const state = await resendVerification(
      { ...user, emailVerified: false },
      { send, consume: vi.fn() },
    );

    expect(state).toEqual({
      status: "error",
      message: "We could not send the email. Try again in a few minutes.",
    });
  });
});
