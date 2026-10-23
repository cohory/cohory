import type { EmailContent } from "../message";
import { buildEmail, eventBrand, type EventCommunity } from "./layout";

export type EventCanceledReason = "canceled" | "deleted" | "not_going";

type EventCanceledInput = EventCommunity & {
  name: string;
  title: string;
  when: string;
  reason: EventCanceledReason;
  calendarUrl: string;
};

const calendarLine = "If you added it to your calendar, this email removes it.";

function wording({ title, when, reason }: EventCanceledInput) {
  if (reason === "not_going") {
    return {
      subject: `Not going: ${title}`,
      lines: [`You're not going to ${title} on ${when}.`, calendarLine],
    };
  }
  return {
    subject: `Canceled: ${title}`,
    lines: [
      reason === "canceled"
        ? `${title} on ${when} is canceled.`
        : `${title} on ${when} no longer takes place.`,
      calendarLine,
    ],
  };
}

export function eventCanceledEmail(input: EventCanceledInput): EmailContent {
  const { subject, lines } = wording(input);
  return buildEmail({
    template: "event-canceled",
    subject,
    preheader: lines[0] ?? subject,
    brand: eventBrand(input),
    body: [`Hi ${input.name},`, ...lines],
    cta: { label: "Open the calendar", url: input.calendarUrl },
  });
}
