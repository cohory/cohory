import { formatDate } from "@cohory/ui/lib/format-date";

export function slugChangeDate(date: Date): string {
  return formatDate(date, { timeZone: "UTC", style: "long" });
}
