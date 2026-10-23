import { zonedParts, zoneAbbreviation } from "./time";

const renamedZones: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

const commonZones: Readonly<Record<string, string>> = {
  UTC: "",
  "America/Los_Angeles": "United States, Pacific",
  "America/Denver": "United States, Mountain",
  "America/Chicago": "United States, Central",
  "America/New_York": "United States, Eastern",
  "America/Toronto": "Canada",
  "America/Mexico_City": "Mexico",
  "America/Sao_Paulo": "Brazil",
  "America/Argentina/Buenos_Aires": "Argentina",
  "Europe/London": "United Kingdom",
  "Europe/Dublin": "Ireland",
  "Europe/Lisbon": "Portugal",
  "Europe/Madrid": "Spain",
  "Europe/Paris": "France",
  "Europe/Berlin": "Germany",
  "Europe/Amsterdam": "Netherlands",
  "Europe/Rome": "Italy",
  "Europe/Stockholm": "Sweden",
  "Europe/Warsaw": "Poland",
  "Europe/Athens": "Greece",
  "Europe/Istanbul": "Turkey",
  "Europe/Kyiv": "Ukraine",
  "Africa/Lagos": "Nigeria",
  "Africa/Cairo": "Egypt",
  "Africa/Johannesburg": "South Africa",
  "Asia/Dubai": "United Arab Emirates",
  "Asia/Kolkata": "India",
  "Asia/Singapore": "Singapore",
  "Asia/Shanghai": "China",
  "Asia/Tokyo": "Japan",
  "Asia/Seoul": "South Korea",
  "Australia/Sydney": "Australia",
  "Pacific/Auckland": "New Zealand",
};

interface TimeZoneOption {
  value: string;
  label: string;
  common: boolean;
  search: string;
}

function canonicalZone(zone: string): string {
  return renamedZones[zone] ?? zone;
}

function offsetMinutesAt(zone: string, at: Date): number {
  const { year, month, day, hour, minute } = zonedParts(at.toISOString(), zone);
  const local = Date.UTC(year, month - 1, day, hour, minute);
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

function cityOf(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}

function timeZoneOption(zone: string, at: Date): TimeZoneOption {
  const name = canonicalZone(zone);
  const offset = formatOffset(offsetMinutesAt(zone, at));
  const country = commonZones[name] ?? "";
  const city = name === "UTC" ? "Coordinated Universal Time" : cityOf(name);
  return {
    value: zone,
    label: name === "UTC" ? "UTC" : `${city} (${offset})`,
    common: name in commonZones,
    search: [city, name, country, zoneAbbreviation(zone, at.toISOString()), offset]
      .join(" ")
      .replaceAll("_", " ")
      .toLowerCase(),
  };
}

function timeZoneChoices(zones: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const zone of zones) seen.add(canonicalZone(zone));
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function zoneInstant(date: string, time: string, zone: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const wall = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  if (Number.isNaN(wall)) return null;
  try {
    let guess = wall - offsetMinutesAt(zone, new Date(wall)) * 60_000;
    guess = wall - offsetMinutesAt(zone, new Date(guess)) * 60_000;
    return new Date(guess);
  } catch {
    return null;
  }
}

function zoneCity(zone: string): string {
  const name = canonicalZone(zone);
  return name === "UTC" ? "UTC" : cityOf(name);
}

export {
  canonicalZone,
  zoneCity,
  formatOffset,
  offsetMinutesAt,
  timeZoneChoices,
  timeZoneOption,
  zoneInstant,
  type TimeZoneOption,
};
