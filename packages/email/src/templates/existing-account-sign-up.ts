import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

type ExistingAccountSignUpInput = {
  name: string;
  signInUrl: string;
  resetUrl: string;
};

export function existingAccountSignUpEmail({
  name,
  signInUrl,
  resetUrl,
}: ExistingAccountSignUpInput): EmailContent {
  return buildEmail({
    template: "existing-account-sign-up",
    subject: "Someone tried to create an account with your email",
    preheader: "Nothing changed on your account.",
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `Someone tried to create a ${instanceName()} account with this email address, which already has one. Nothing changed on your account.`,
      "If it was you, sign in with your existing account:",
    ],
    cta: { label: "Sign in", url: signInUrl },
    after: [
      { kind: "link", label: "Forgot your password?", url: resetUrl },
      "If it was not you, you can ignore this email.",
    ],
  });
}
