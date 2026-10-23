const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatAbsoluteDate(value: string | Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(toDate(value));
}

export function formatRelativeTime(
  value: string | Date,
  now: Date = new Date(),
  locale?: string,
): string {
  const date = toDate(value);
  const elapsed = now.getTime() - date.getTime();
  if (Number.isNaN(elapsed)) return "";
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatAbsoluteDate(date, locale);
}

interface RelativeTimeProps {
  value: string | Date;
  now?: Date;
  locale?: string;
  className?: string;
}

export function RelativeTime({ value, now, locale, className }: RelativeTimeProps) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time
      dateTime={date.toISOString()}
      title={formatAbsoluteDate(date, locale)}
      className={className}
      suppressHydrationWarning
    >
      {formatRelativeTime(date, now, locale)}
    </time>
  );
}
