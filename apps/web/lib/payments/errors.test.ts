import {
  PaidSignupsPausedError,
  ProviderDisabledError,
  ProviderRejectedError,
} from "@cohory/payments";
import { describe, expect, it } from "vitest";

import { paymentsActionFailure } from "./errors";

describe("paymentsActionFailure", () => {
  it("tells a buyer that new memberships are paused without mentioning the invoice", () => {
    expect(paymentsActionFailure(new PaidSignupsPausedError(), "member")).toEqual({
      ok: false,
      message: "New memberships are paused in this community for now. Try again later.",
    });
    expect(paymentsActionFailure(new PaidSignupsPausedError(), "creator")?.message).toContain(
      "Existing members keep access",
    );
  });

  it("tells the creator to connect Stripe and the buyer that memberships are not for sale when Polar is off", () => {
    expect(paymentsActionFailure(new ProviderDisabledError("polar"), "creator")?.message).toBe(
      "Polar is not available on this server. Connect Stripe instead.",
    );
    expect(paymentsActionFailure(new ProviderDisabledError("polar"), "member")?.message).toBe(
      "Memberships are not for sale right now. Try again later.",
    );
  });

  it("names the provider that refused a token", () => {
    expect(
      paymentsActionFailure(new ProviderRejectedError("Polar", 401, "Unauthorized"), "creator")
        ?.message,
    ).toBe("Polar refused the access token. Check that it is current and has the scopes it needs.");
  });
});
