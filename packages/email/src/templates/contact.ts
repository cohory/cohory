import { headerSafe, instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail } from "./layout";

export interface ContactCommunityLine {
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

export interface ContactAccountBlock {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly communities: readonly ContactCommunityLine[];
  readonly moreCommunities: number;
}

export interface ContactMessageInput {
  readonly topic: string;
  readonly name: string;
  readonly email: string;
  readonly message: string;
  readonly link: string | null;
  readonly account: ContactAccountBlock | null;
  readonly edition: string;
  readonly instanceUrl: string;
  readonly ipHash: string | null;
  readonly sentAt: string;
}

function communityList(communities: readonly ContactCommunityLine[], withRole: boolean): string {
  return communities.length === 0
    ? "none"
    : communities
        .map(({ name, slug, role }) => `${name} (${withRole ? `${slug}, ${role}` : slug})`)
        .join("; ");
}

function accountLines(account: ContactAccountBlock | null): string[] {
  if (!account) {
    return ["Account: Not signed in"];
  }
  const owned = account.communities.filter((community) => community.role === "owner");
  const joined = account.communities.filter((community) => community.role !== "owner");
  return [
    "Account",
    `User id: ${account.id}`,
    `Name: ${account.name}`,
    `Account email: ${account.email} (${account.emailVerified ? "verified" : "not verified"})`,
    `Account created: ${account.createdAt.slice(0, 10)}`,
    `Owns: ${communityList(owned, false)}`,
    `Member of: ${communityList(joined, true)}`,
    ...(account.moreCommunities > 0
      ? [`And ${account.moreCommunities} more communities not listed.`]
      : []),
  ];
}

export function contactMessageSubject(
  input: Pick<ContactMessageInput, "topic" | "message">,
): string {
  return `[${headerSafe(instanceName(), 60)} contact] ${input.topic}: ${headerSafe(input.message, 60)}`;
}

export function contactMessageEmail(input: ContactMessageInput): EmailContent {
  return buildEmail({
    template: "contact-message",
    subject: contactMessageSubject(input),
    preheader: input.message.slice(0, 120),
    brand: { kind: "instance" },
    body: [
      "Someone wrote through the contact form. Reply to this email to answer them.",
      `Topic: ${input.topic}`,
      `From: ${input.name} <${input.email}>${input.account ? "" : " (not signed in)"}`,
      `Page or community: ${input.link ?? "none given"}`,
      "Message:",
      ...input.message.split(/\n\s*\n/),
      ...accountLines(input.account),
      `Edition: ${input.edition}`,
      `Instance: ${input.instanceUrl}`,
      ...(input.ipHash ? [`Client address hash: ${input.ipHash}`] : []),
      `Received: ${input.sentAt}`,
    ],
  });
}
