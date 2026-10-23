const maxNameLength = 50;

function isUnsafeCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    (code >= 0x7f && code < 0xa0) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

export function flattenEmailText(value: string): string {
  return Array.from(value, (character) => (isUnsafeCharacter(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const linkPattern = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi;
const formulaStart = /^[=+\-@]/;
const emailLike = /\S+@\S+\.\S+/;
const domainLike = /^[^\s/]+\.[a-z]{2,}(?:\/\S*)?$/i;

// Display names are chosen by anyone and sent from the platform's domain, so a name that
// reads as a link, an address, or a spreadsheet formula is a phishing or injection vector.
export function emailSafeName(raw: string | null | undefined): string | null {
  const flat = flattenEmailText(raw ?? "");
  if (formulaStart.test(flat) || emailLike.test(flat) || domainLike.test(flat)) {
    return null;
  }
  const cleaned = flattenEmailText(flat.replace(linkPattern, " "));
  return cleaned === "" ? null : Array.from(cleaned).slice(0, maxNameLength).join("").trim();
}

export function emailGreeting(name: string | null | undefined): string {
  const safe = emailSafeName(name);
  return safe ? `Hi ${safe},` : "Hi,";
}
