import type { NextEventTeaser } from "@cohory/calendar";

const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

function dayLabel(date: Date): string {
  return day.format(date).replace(",", "");
}

export function nextEventLine(teaser: NextEventTeaser | null): string | null {
  if (!teaser) {
    return null;
  }
  if (teaser.kind === "date") {
    return `Next event: ${dayLabel(new Date(`${teaser.date}T00:00:00Z`))}`;
  }
  return `Next event: ${teaser.title}, ${dayLabel(teaser.startsAt)}, ${time.format(teaser.startsAt)} UTC`;
}
