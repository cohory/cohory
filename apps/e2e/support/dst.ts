const zone = "Europe/Berlin";

function offsetHours(instant: Date): number {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = part?.match(/GMT([+-]\d+)?/);
  return match?.[1] ? Number(match[1]) : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface DstWeek {
  readonly first: string;
  readonly second: string;
  readonly firstStartsAt: string;
  readonly secondStartsAt: string;
}

export function nextTuesdayPairAcrossDst(now: Date = new Date()): DstWeek {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  for (let i = 0; i < 400; i += 1) {
    if (day.getUTCDay() === 2) {
      const next = new Date(day.getTime() + 7 * 86_400_000);
      const firstOffset = offsetHours(new Date(day.getTime() + 16 * 3_600_000));
      const secondOffset = offsetHours(new Date(next.getTime() + 16 * 3_600_000));
      if (firstOffset !== secondOffset) {
        const at = (date: Date, offset: number) =>
          new Date(date.getTime() + (18 - offset) * 3_600_000).toISOString();
        return {
          first: isoDate(day),
          second: isoDate(next),
          firstStartsAt: at(day, firstOffset),
          secondStartsAt: at(next, secondOffset),
        };
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  throw new Error("no daylight saving change in Europe/Berlin within 400 days");
}
