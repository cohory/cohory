const browsers: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, "Edge"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const systems: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

function first(userAgent: string, patterns: readonly (readonly [RegExp, string])[]) {
  return patterns.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) {
    return null;
  }
  const browser = first(userAgent, browsers);
  const system = first(userAgent, systems);
  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser ?? system;
}
