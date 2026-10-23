import { headerSafe, instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

export interface EarlyAccessRequestInput {
  readonly email: string;
  readonly platform: string;
  readonly members: string;
  readonly note: string | null;
  readonly account: { readonly id: string; readonly email: string } | null;
  readonly edition: string;
  readonly instanceUrl: string;
  readonly ipHash: string | null;
  readonly sentAt: string;
}

export function earlyAccessRequestSubject(
  input: Pick<EarlyAccessRequestInput, "platform" | "members">,
): string {
  return `[${headerSafe(instanceName(), 60)} early access] ${headerSafe(input.platform, 40)}, ${headerSafe(input.members, 40)}`;
}

export function earlyAccessRequestEmail(input: EarlyAccessRequestInput): EmailContent {
  return buildEmail({
    template: "early-access-request",
    subject: earlyAccessRequestSubject(input),
    preheader: `${input.platform}, ${input.members} paying members`,
    brand: { kind: "instance" },
    body: [
      "A creator asked for early access to Cloud. Reply to this email to answer them.",
      `Email: ${input.email}`,
      `Platform today: ${input.platform}`,
      `Paying members: ${input.members}`,
      ...(input.note
        ? ["Anything else:", ...input.note.split(/\n\s*\n/)]
        : ["Anything else: none"]),
      input.account
        ? `Account: ${input.account.id} (${input.account.email})`
        : "Account: Not signed in",
      `Edition: ${input.edition}`,
      `Instance: ${input.instanceUrl}`,
      ...(input.ipHash ? [`Client address hash: ${input.ipHash}`] : []),
      `Received: ${input.sentAt}`,
    ],
  });
}
