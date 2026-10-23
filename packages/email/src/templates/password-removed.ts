import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

type PasswordRemovedInput = {
  name: string;
  securityUrl: string;
};

export function passwordRemovedEmail({ name, securityUrl }: PasswordRemovedInput): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "password-removed",
    subject: `We removed the password on your ${instance} account`,
    preheader: "If you set it, choose a new one from Account, Security.",
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      "For your security we removed the password on this account, because it was set before your email was confirmed. If you set it, choose a new one from Account, Security.",
      "We also signed out your other devices. You can keep signing in with an email link.",
    ],
    cta: { label: "Open Security", url: securityUrl },
  });
}
