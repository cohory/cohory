import { describe, expect, it } from "vitest";

import { allCopy } from "../test/copy";

import { emailVerificationEmail } from "./email-verification";
import { existingAccountSignUpEmail } from "./existing-account-sign-up";
import { passwordResetEmail } from "./password-reset";
import { movingOfferEmail } from "./moving-offer";
import { subscriptionMovedEmail } from "./subscription-moved";

const url = "http://localhost:3000/api/auth/reset-password/abc123?callbackURL=%2Freset-password";

describe("passwordResetEmail", () => {
  const email = passwordResetEmail({ name: "Ada", url, expiresInMinutes: 60 });

  it("names the action in the subject", () => {
    expect(email.subject).toBe("Reset your Cohory password");
  });

  it("includes the reset link and the expiry in the text body", () => {
    expect(email.text).toContain(url);
    expect(email.text).toContain("1 hour");
    expect(email.text).toContain("Hi Ada,");
  });

  it("links the reset URL in the html body with the ampersands escaped", () => {
    const withQuery = passwordResetEmail({ name: "Ada", url: `${url}&a=1`, expiresInMinutes: 60 });

    expect(withQuery.html).toContain(`href="${url}&amp;a=1"`);
  });

  it("escapes markup in the recipient name", () => {
    const hostile = passwordResetEmail({ name: "<script>x</script>", url, expiresInMinutes: 60 });

    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });

  it("states minutes when the expiry is not a whole number of hours", () => {
    expect(passwordResetEmail({ name: "Ada", url, expiresInMinutes: 30 }).text).toContain(
      "30 minutes",
    );
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("emailVerificationEmail", () => {
  const verifyUrl = "http://localhost:3000/api/auth/verify-email?token=xyz&callbackURL=%2F";
  const email = emailVerificationEmail({ name: "Ada", url: verifyUrl });

  it("names the action in the subject", () => {
    expect(email.subject).toBe("Confirm your email address");
  });

  it("includes the verification link in both bodies", () => {
    expect(email.text).toContain(verifyUrl);
    expect(email.html).toContain(verifyUrl.replace("&", "&amp;"));
  });

  it("says how long the link works", () => {
    expect(email.text).toContain("The link works for 1 hour.");
  });

  it("fits a resend from an existing member as well as a new sign up", () => {
    expect(email.text).toContain("If you did not ask for this, you can ignore this email.");
    expect(email.text).not.toContain("did not create");
  });

  it("uses no exclamation marks", () => {
    expect(allCopy(email)).not.toContain("!");
  });
});

describe("subscriptionMovedEmail", () => {
  const moved = subscriptionMovedEmail({
    communityName: "Design <Club>",
    email: "ada@example.test",
    url: "http://localhost:3000/c/design/membership",
  });

  it("names the community and says nothing is charged again", () => {
    expect(moved.subject).toBe("[Design <Club>] Your membership has moved");
    expect(moved.text).toContain("You don't pay again");
    expect(moved.text).toContain("ada@example.test");
    expect(moved.text).toContain("/c/design/membership");
    expect(moved.text).not.toContain("!");
  });

  it("escapes the community name in the html body", () => {
    expect(moved.html).toContain("Design &lt;Club&gt;");
    expect(moved.html).not.toContain("<Club>");
  });
});

describe("movingOfferEmail", () => {
  const offer = (freeUntil: Date | null, from: string | null) =>
    movingOfferEmail({
      communityName: "Design Club",
      email: "ada@example.test",
      url: "http://localhost:3000/c/design/membership",
      freeUntil,
      from,
    });

  it("says when the first charge comes and to cancel on the old platform now", () => {
    const email = offer(new Date("2026-11-18T00:00:00.000Z"), "Skool");
    expect(email.subject).toBe("[Design Club] Keep your membership");
    expect(email.text).toContain("has moved from Skool");
    expect(email.text).toContain("You won't be charged until November 18, 2026");
    expect(email.text).toContain("Cancel your old subscription on Skool now");
    expect(email.text).toContain("ada@example.test");
    expect(email.text).not.toContain("!");
  });

  it("asks to cancel once the new subscription starts when there is no free time", () => {
    const email = offer(null, null);
    expect(email.text).not.toContain("won't be charged until");
    expect(email.text).toContain("Cancel your old subscription once the new one starts");
  });
});

describe("existingAccountSignUpEmail", () => {
  const signInUrl = "https://community.example.com/sign-in";
  const resetUrl = "https://community.example.com/forgot-password";
  const email = existingAccountSignUpEmail({ name: "Ada", signInUrl, resetUrl });

  it("makes sign in the main action and offers the password reset second", () => {
    expect(email.subject).toBe("Someone tried to create an account with your email");
    expect(email.html).toContain(`>Sign in</a>`);
    expect(email.text.indexOf(signInUrl)).toBeGreaterThan(-1);
    expect(email.text.indexOf(resetUrl)).toBeGreaterThan(email.text.indexOf(signInUrl));
    expect(email.text).toContain("Forgot your password?");
  });

  it("says nothing changed on the account", () => {
    expect(email.text).toContain("Nothing changed on your account");
  });
});
