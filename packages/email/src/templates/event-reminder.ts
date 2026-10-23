import type { EmailContent } from "../message";
import { buildEmail, eventBrand, type EmailBlock, type EventCommunity } from "./layout";

export type EventEmailFooter = {
  unsubscribeUrl: string;
  preferencesUrl: string;
};

export type EventEmailInput = EventCommunity & {
  name: string;
  title: string;
  when: string;
  eventWhen: string | null;
  location: string | null;
  eventUrl: string;
  footer: EventEmailFooter | null;
};

export function joinUrlOf(location: string | null): string | null {
  if (!location) {
    return null;
  }
  try {
    const url = new URL(location);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function eventFacts(input: EventEmailInput): string[] {
  const joinUrl = joinUrlOf(input.location);
  return [
    `When: ${input.when}`,
    ...(input.eventWhen ? [`Event time: ${input.eventWhen}`] : []),
    ...(input.location && !joinUrl ? [`Where: ${input.location}`] : []),
  ];
}

export function eventFooter(footer: EventEmailFooter | null) {
  return footer
    ? {
        why: "You get this email because you said you are going and event reminder emails are on.",
        links: [
          { label: "Stop event reminder emails", url: footer.unsubscribeUrl },
          { label: "Change your notification settings", url: footer.preferencesUrl },
        ],
      }
    : undefined;
}

export function eventReminderEmail(input: EventEmailInput): EmailContent {
  const joinUrl = joinUrlOf(input.location);
  const facts = eventFacts(input);
  const details = { label: "Event details", url: input.eventUrl };
  const after: EmailBlock[] = joinUrl ? [{ kind: "link", ...details }] : [];

  return buildEmail({
    template: "event-reminder",
    subject: `Starts in 1 hour: ${input.title}`,
    preheader: facts.join(". "),
    brand: eventBrand(input),
    body: [
      `Hi ${input.name},`,
      `${input.title} starts in 1 hour. You said you are going.`,
      ...facts,
    ],
    cta: joinUrl ? { label: "Join the call", url: joinUrl } : details,
    after: [...after, "Plans changed? Update your RSVP on the event page."],
    footer: eventFooter(input.footer),
  });
}
