const memberRules = new Intl.PluralRules("en-US");
const numbers = new Intl.NumberFormat("en-US");

export function memberCountLabel(count: number): string {
  if (count === 0) {
    return "No members yet";
  }
  const noun = memberRules.select(count) === "one" ? "member" : "members";
  return `${numbers.format(count)} ${noun}`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
