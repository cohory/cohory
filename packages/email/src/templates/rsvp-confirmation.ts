import type { EmailContent } from "../message";
import { eventFacts, eventFooter, type EventEmailInput } from "./event-reminder";
import { buildEmail, eventBrand } from "./layout";

type RsvpConfirmationInput = EventEmailInput & {
  icsUrl: string;
};

export function rsvpConfirmationEmail(input: RsvpConfirmationInput): EmailContent {
  return buildEmail({
    template: "rsvp-confirmation",
    subject: `You're going: ${input.title}`,
    preheader: `${input.when}. Add it to your calendar.`,
    brand: eventBrand(input),
    body: [`Hi ${input.name},`, `You're going to ${input.title}.`, ...eventFacts(input)],
    cta: { label: "Add to calendar", url: input.icsUrl },
    after: [
      { kind: "link", label: "Event details", url: input.eventUrl },
      "We'll remind you 1 hour before it starts. Plans changed? Update your RSVP on the event page.",
    ],
    footer: eventFooter(input.footer),
  });
}
