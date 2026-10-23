function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function scheduleInstant(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function localInputValue(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function atNine(day: Date, offsetDays: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offsetDays, 9, 0);
}

export function schedulePresets(now: Date): { tomorrow: string; monday: string } {
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  return {
    tomorrow: localInputValue(atNine(now, 1)),
    monday: localInputValue(atNine(now, daysToMonday)),
  };
}

export function timeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
