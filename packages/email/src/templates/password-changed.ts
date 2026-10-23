import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

type PasswordChangedInput = {
  name: string;
  changedAt: Date;
  device: string | null;
  resetUrl: string;
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function passwordChangedEmail({
  name,
  changedAt,
  device,
  resetUrl,
}: PasswordChangedInput): EmailContent {
  const instance = instanceName();
  const when = `${dateFormat.format(changedAt)} at ${timeFormat.format(changedAt)} UTC`;
  return buildEmail({
    template: "password-changed",
    subject: `Your ${instance} password was changed`,
    preheader: "If this was not you, reset it now.",
    brand: { kind: "instance" },
    body: [
      `Hi ${name},`,
      `The password for your ${instance} account was changed on ${when}. Every other device was signed out.`,
      ...(device ? [`Device: ${device}.`] : []),
      "If this was not you, reset it now.",
    ],
    cta: { label: "Reset password", url: resetUrl },
    after: ["If it was you, there is nothing else to do."],
  });
}
