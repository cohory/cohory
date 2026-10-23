import { describe, expect, it } from "vitest";

import { allCopy } from "../test/copy";
import { changeEmailConfirmationEmail, changeEmailVerificationEmail } from "./change-email";
import { magicLinkEmail } from "./magic-link";
import { passwordChangedEmail } from "./password-changed";
import { passwordRemovedEmail } from "./password-removed";

const app = "http://localhost:3000";

describe("magicLinkEmail", () => {
  const url = `${app}/api/auth/magic-link/verify?token=abc&callbackURL=%2F`;
  const email = magicLinkEmail({ url, expiresInMinutes: 15 });

  it("names the action and says how long the link works", () => {
    expect(email.subject).toBe("Your Cohory sign in link");
    expect(email.text).toContain(url);
    expect(email.text).toContain("15 minutes");
    expect(email.text).toContain("only once");
  });

  it("tells someone who did not ask that they can ignore it", () => {
    expect(email.text).toContain("If you did not ask for this, you can ignore this email.");
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("changeEmailVerificationEmail", () => {
  const url = `${app}/api/auth/verify-email?token=abc&callbackURL=%2Fverified`;
  const email = changeEmailVerificationEmail({
    name: "Ada",
    newEmail: "ada.new@example.com",
    url,
    expiresInMinutes: 60,
  });

  it("asks the new address to confirm itself", () => {
    expect(email.subject).toBe("Confirm your new email address");
    expect(email.text).toContain("ada.new@example.com");
    expect(email.text).toContain(url);
    expect(email.text).toContain("The link works for 1 hour.");
    expect(email.html).toContain(">Confirm new address</a>");
  });
});

describe("passwordChangedEmail", () => {
  const resetUrl = `${app}/forgot-password`;
  const email = passwordChangedEmail({
    name: "Ada",
    changedAt: new Date("2026-10-22T09:30:00.000Z"),
    device: "Firefox on macOS",
    resetUrl,
  });

  it("says the password changed, when, and on which device", () => {
    expect(email.subject).toBe("Your Cohory password was changed");
    expect(email.text).toContain("October 22, 2026");
    expect(email.text).toContain("09:30 UTC");
    expect(email.text).toContain("Firefox on macOS");
  });

  it("offers a reset for someone who did not change it", () => {
    expect(email.text).toContain("If this was not you, reset it now.");
    expect(email.html).toContain(">Reset password</a>");
    expect(email.text).toContain(resetUrl);
  });

  it("leaves the device out when it is unknown", () => {
    const unknown = passwordChangedEmail({
      name: "Ada",
      changedAt: new Date("2026-10-22T09:30:00.000Z"),
      device: null,
      resetUrl,
    });

    expect(unknown.text).not.toContain("Device:");
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("changeEmailConfirmationEmail", () => {
  const url = `${app}/api/auth/verify-email?token=abc&callbackURL=%2Fverified`;
  const email = changeEmailConfirmationEmail({
    name: "Ada",
    newEmail: "ada.new@example.com",
    url,
    expiresInMinutes: 60,
    securityUrl: `${app}/forgot-password`,
  });

  it("asks the current address to approve the move before anything is sent to the new one", () => {
    expect(email.subject).toBe("Approve your new Cohory email address");
    expect(email.text).toContain("ada.new@example.com");
    expect(email.text).toContain(url);
    expect(email.text).toContain("The link works for 1 hour.");
    expect(email.html).toContain(">Approve the change</a>");
  });

  it("tells someone who did not ask to secure the account", () => {
    expect(email.text).toContain("If this was not you, do not open the link");
    expect(email.text).toContain(`${app}/forgot-password`);
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("passwordRemovedEmail", () => {
  const email = passwordRemovedEmail({ name: "Ada", securityUrl: `${app}/account/security` });

  it("says calmly why the password was removed and where to choose a new one", () => {
    expect(email.subject).toBe("We removed the password on your Cohory account");
    expect(email.text).toContain(
      "For your security we removed the password on this account, because it was set before your email was confirmed. If you set it, choose a new one from Account, Security.",
    );
    expect(allCopy(email)).not.toContain("did not set");
    expect(email.html).toContain(">Open Security</a>");
    expect(allCopy(email)).not.toContain("!");
  });
});
