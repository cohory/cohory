import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { formatDuration } from "./html";
import { buildEmail } from "./layout";

type ChangeEmailVerificationInput = {
  name: string;
  newEmail: string;
  url: string;
  expiresInMinutes: number;
};

export function changeEmailVerificationEmail({
  name,
  newEmail,
  url,
  expiresInMinutes,
}: ChangeEmailVerificationInput): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "change-email-verification",
    subject: "Confirm your new email address",
    preheader: `Your ${instance} account moves to this address once you confirm.`,
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `You asked to use ${newEmail} for your ${instance} account. Confirm this address to finish the change:`,
    ],
    cta: { label: "Confirm new address", url },
    after: [
      `The link works for ${formatDuration(expiresInMinutes)}. Until you confirm, your account keeps its current email address. If you did not ask for this, you can ignore this email.`,
    ],
  });
}

type ChangeEmailConfirmationInput = {
  name: string;
  newEmail: string;
  url: string;
  expiresInMinutes: number;
  securityUrl: string;
};

export function changeEmailConfirmationEmail({
  name,
  newEmail,
  url,
  expiresInMinutes,
  securityUrl,
}: ChangeEmailConfirmationInput): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "change-email-confirmation",
    subject: `Approve your new ${instance} email address`,
    preheader: "Nothing changes until you approve it from this address.",
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `Someone signed in to your ${instance} account asked to move it to ${newEmail}. Approve the change from this address first. We then ask ${newEmail} to confirm itself.`,
    ],
    cta: { label: "Approve the change", url },
    after: [
      `The link works for ${formatDuration(expiresInMinutes)}. If this was not you, do not open the link, and secure your account with a new password: ${securityUrl}`,
    ],
  });
}
