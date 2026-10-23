import type { EmailContent } from "../message";
import { buildEmail, eventBrand, type EventCommunity } from "./layout";

type EventUpdatedInput = EventCommunity & {
  name: string;
  eventTitle: string;
  oldStart: string;
  newStart: string;
  series: boolean;
  eventUrl: string;
  icsUrl: string;
};

export function eventUpdatedEmail(input: EventUpdatedInput): EmailContent {
  const { name, eventTitle, oldStart, newStart, series, eventUrl, icsUrl } = input;
  const intro = series
    ? `${eventTitle} has a new time. The change applies to every upcoming date in the series.`
    : `${eventTitle} has a new time.`;

  return buildEmail({
    template: "event-updated",
    subject: `New time: ${eventTitle}`,
    preheader: `Now: ${newStart}. You are still going.`,
    brand: eventBrand(input),
    body: [`Hi ${name},`, intro, `Was: ${oldStart}`, `Now: ${newStart}`, "You are still going."],
    cta: { label: "Open the event", url: eventUrl },
    after: [
      { kind: "link", label: "Add the new time to your calendar", url: icsUrl },
      "Plans changed? Update your RSVP on the event page.",
    ],
  });
}
