import { instanceName } from "../brand";
import { emailGreeting, emailSafeName, flattenEmailText } from "../names";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput, type EmailFooter } from "./layout";

interface CommunityInput {
  readonly name: string;
  readonly communityName: string;
  readonly url: string;
  readonly communityBrand?: CommunityBrandInput;
}

export type FirstContactOrigin =
  | { readonly kind: "list" }
  | { readonly kind: "archive" }
  | { readonly kind: "platform"; readonly name: string };

export interface FirstContact {
  readonly inviterName: string;
  readonly origin: FirstContactOrigin;
  readonly optOutUrl: string;
}

export interface CommunityMove {
  readonly inviterName: string;
  readonly origin: FirstContactOrigin;
}

interface FirstContactInput extends CommunityInput {
  readonly firstContact?: FirstContact;
  readonly move?: CommunityMove;
  readonly moved?: readonly string[];
  readonly note?: string | null;
}

export const migrationNoteMaxLength = 500;

const noteLinks =
  /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*|\S+@\S+\.\S+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b(?:[/?#]\S*)?/gi;

// The note is the owner's own text, sent from the platform's domain to people who never signed
// up, so it stays plain text without links that could pass for the platform's.
export function emailSafeNote(raw: string | null | undefined): string | null {
  const cleaned = flattenEmailText(flattenEmailText(raw ?? "").replace(noteLinks, " "));
  return cleaned === ""
    ? null
    : Array.from(cleaned).slice(0, migrationNoteMaxLength).join("").trim();
}

function invitedBecause(communityName: string, origin: FirstContactOrigin): string {
  switch (origin.kind) {
    case "list":
      return `your address is on their member list for ${communityName}`;
    case "archive":
      return `you were a member of ${communityName} before it moved`;
    case "platform":
      return `you were a member of ${communityName} on ${origin.name}`;
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

export function firstContactFooter(
  communityName: string,
  firstContact: FirstContact | undefined,
): EmailFooter | undefined {
  if (!firstContact) {
    return undefined;
  }
  return {
    why: `${emailSafeName(firstContact.inviterName) ?? "Someone"} invited you because ${invitedBecause(communityName, firstContact.origin)}.`,
    links: [{ label: `Don't email me about ${communityName}`, url: firstContact.optOutUrl }],
  };
}

function inviter(move: CommunityMove | undefined): string {
  return (move && emailSafeName(move.inviterName)) ?? "The owner";
}

function moveLine(communityName: string, move: CommunityMove): string {
  const who = inviter(move);
  switch (move.origin.kind) {
    case "platform":
      return `${who} moved ${communityName} from ${move.origin.name} to ${instanceName()}.`;
    case "archive":
      return `${who} moved ${communityName} to ${instanceName()}.`;
    case "list":
      return `${who} invited you to join ${communityName} on ${instanceName()}.`;
    default: {
      const exhaustive: never = move.origin;
      return exhaustive;
    }
  }
}

function alreadyThere(moved: readonly string[] | undefined): string | null {
  if (!moved || moved.length === 0) return null;
  const last = moved[moved.length - 1];
  const items = moved.length === 1 ? last : `${moved.slice(0, -1).join(", ")} and ${last}`;
  return `Your ${items} ${moved.length === 1 && !last?.endsWith("s") ? "is" : "are"} already there.`;
}

function noteLine(move: CommunityMove | undefined, note: string | null | undefined): string[] {
  const safe = emailSafeNote(note);
  return safe ? [`A note from ${inviter(move)}: "${safe}"`] : [];
}

const linkLifetime = "The link works once and expires in 30 days.";
const passwordLinkLifetime = "The link works once and expires in 7 days.";

export function communityMovedEmail({
  name,
  communityName,
  url,
  communityBrand: brand,
  firstContact,
  move,
  moved,
  note,
}: FirstContactInput): EmailContent {
  const already = alreadyThere(moved);
  const opening = move
    ? `${moveLine(communityName, move)} Your membership came with it.`
    : `${communityName} has moved to a new home, and your membership came with it.`;
  return buildEmail({
    template: "community-moved",
    subject: "The community has moved",
    preheader: ["Choose a password to sign in.", already].filter(Boolean).join(" "),
    brand: communityBrand(communityName, brand),
    body: [
      emailGreeting(name),
      `${opening} To sign in, choose a password with this link:`,
      ...noteLine(move, note),
    ],
    cta: { label: "Choose a password", url },
    after: [
      ...(already ? [already] : []),
      `Use the email address this message was sent to. ${passwordLinkLifetime}`,
    ],
    footer: firstContactFooter(communityName, firstContact),
  });
}

interface MemberAddedInput extends CommunityInput {
  readonly hasPassword: boolean;
}

export function memberAddedEmail({
  name,
  communityName,
  url,
  hasPassword,
  communityBrand: brand,
}: MemberAddedInput): EmailContent {
  return buildEmail({
    template: "member-added",
    subject: "You were added to the community",
    preheader: hasPassword
      ? "Open it with your existing account."
      : "Choose a password to sign in.",
    brand: communityBrand(communityName, brand),
    body: [
      emailGreeting(name),
      hasPassword
        ? `You are now a member of ${communityName}. Open it here:`
        : `You are now a member of ${communityName}. To sign in, choose a password with this link:`,
    ],
    cta: { label: hasPassword ? `Open ${communityName}` : "Choose a password", url },
    after: ["If you did not expect this, you can ignore this email or leave the community."],
  });
}

export function memberInvitedEmail({
  name,
  communityName,
  url,
  communityBrand: brand,
  firstContact,
  move,
  moved,
  note,
}: FirstContactInput): EmailContent {
  const rejoin = move !== undefined && move.origin.kind !== "list";
  const already = rejoin ? alreadyThere(moved) : null;
  const opening = move
    ? `${moveLine(communityName, move)} ${rejoin ? "Join with your own account to get back in:" : "Open this link to accept:"}`
    : `You are invited to join ${communityName}. Open this link to accept:`;
  return buildEmail({
    template: "member-invited",
    subject: "You are invited to join",
    preheader: rejoin
      ? ["Join with your own account to get back in.", already].filter(Boolean).join(" ")
      : linkLifetime,
    brand: communityBrand(communityName, brand),
    body: [emailGreeting(name), opening, ...noteLine(move, note)],
    cta: { label: `Join ${communityName}`, url },
    after: [
      ...(already ? [already] : []),
      `${linkLifetime} If you did not expect this, ignore it.`,
    ],
    footer: firstContactFooter(communityName, firstContact),
  });
}
