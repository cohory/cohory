export const stripeConnectCountries = [
  "AE",
  "AT",
  "AU",
  "BE",
  "BG",
  "BR",
  "CA",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GI",
  "GR",
  "HK",
  "HR",
  "HU",
  "IE",
  "IN",
  "IT",
  "JP",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "MX",
  "MY",
  "NL",
  "NO",
  "NZ",
  "PL",
  "PT",
  "RO",
  "SE",
  "SG",
  "SI",
  "SK",
  "TH",
  "US",
] as const;

export type StripeConnectCountry = (typeof stripeConnectCountries)[number];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryOptions(): { code: StripeConnectCountry; name: string }[] {
  return stripeConnectCountries
    .map((code) => ({ code, name: regionNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function isStripeConnectCountry(code: string): code is StripeConnectCountry {
  return stripeConnectCountries.some((country) => country === code);
}

export function countryFromLocales(locales: readonly string[]): StripeConnectCountry | null {
  for (const tag of locales) {
    let region: string | undefined;
    try {
      region = new Intl.Locale(tag).maximize().region;
    } catch {
      continue;
    }
    if (region && isStripeConnectCountry(region)) return region;
  }
  return null;
}
