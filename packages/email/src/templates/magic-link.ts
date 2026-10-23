import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { formatDuration } from "./html";
import { buildEmail } from "./layout";

type MagicLinkInput = {
  url: string;
  expiresInMinutes: number;
};

export function magicLinkEmail({ url, expiresInMinutes }: MagicLinkInput): EmailContent {
  const instance = instanceName();
  const duration = formatDuration(expiresInMinutes);
  return buildEmail({
    template: "magic-link",
    subject: `Your ${instance} sign in link`,
    preheader: `Works for ${duration} on this device.`,
    brand: { kind: "instance" },
    body: [`Open this link to sign in to your ${instance} account:`],
    cta: { label: "Sign in", url },
    after: [
      `The link works for ${duration} and only once. If you did not ask for this, you can ignore this email.`,
    ],
  });
}
