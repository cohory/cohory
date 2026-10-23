import type { EmailContent } from "../message";
import { buildEmail, eventBrand, type EventCommunity } from "./layout";

type EventDatesRemovedInput = EventCommunity & {
  name: string;
  eventTitle: string;
  dates: string[];
  calendarUrl: string;
};

export function eventDatesRemovedEmail(input: EventDatesRemovedInput): EmailContent {
  const { name, eventTitle, dates, calendarUrl } = input;
  const one = dates.length === 1;
  const removed = dates.map((date) => `Removed: ${date}`);

  return buildEmail({
    template: "event-dates-removed",
    subject: `${one ? "Date" : "Dates"} removed: ${eventTitle}`,
    preheader: `${removed.join(". ")}.`,
    brand: eventBrand(input),
    body: [
      `Hi ${name},`,
      one
        ? `${eventTitle} no longer takes place on a date you said you were going to.`
        : `${eventTitle} no longer takes place on dates you said you were going to.`,
      ...removed,
      one ? "Your RSVP for it is removed too." : "Your RSVPs for them are removed too.",
    ],
    cta: { label: "Open the calendar", url: calendarUrl },
    after: ["See the other dates in the community calendar."],
  });
}
