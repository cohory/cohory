import { instanceName, instanceUrl } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

export function testEmail(): EmailContent {
  const instance = instanceName();
  return buildEmail({
    template: "test",
    subject: `Test email from ${instance}`,
    preheader: "If you can read this, email sending works.",
    brand: { kind: "instance" },
    body: [
      `This is a test email from ${instance} at ${instanceUrl()}.`,
      "If you can read this, email sending works. Check that it arrived in the inbox and not in spam, and that the sender shows your domain.",
    ],
    footer: { why: "You received this email because an operator ran the email test command." },
  });
}
