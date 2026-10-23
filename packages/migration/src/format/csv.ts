const formulaTrigger = /^[=+\-@\t\r]/;
const needsQuotes = /[",\r\n]/;

export function csvField(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value !== "string") return String(value);
  const safe = formulaTrigger.test(value) ? `'${value}` : value;
  return needsQuotes.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly (string | number | boolean | null)[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}
