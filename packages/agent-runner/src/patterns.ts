export const maxPatternLength = 256;

const quantifier = /[*+?]|\{\d+(,\d*)?\}/;

function groupBodies(pattern: string): string[] {
  const bodies: string[] = [];
  const starts: number[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "(") {
      starts.push(index);
    } else if (character === ")") {
      const start = starts.pop();
      if (start === undefined) continue;
      const after = pattern.slice(index + 1);
      if (/^([*+]|\{\d+,\d*\})/.test(after)) {
        bodies.push(pattern.slice(start + 1, index));
      }
    }
  }
  return bodies;
}

function stripEscapesAndClasses(text: string): string {
  return text.replace(/\\./g, "x").replace(/\[[^\]]*\]/g, "x");
}

export function unsafePatternReason(pattern: string): string | null {
  if (pattern.length > maxPatternLength) {
    return `is longer than ${maxPatternLength} characters`;
  }
  if (/\\[1-9]|\\k</.test(pattern)) {
    return "uses a back reference";
  }
  for (const body of groupBodies(pattern)) {
    const plain = stripEscapesAndClasses(body);
    if (quantifier.test(plain)) {
      return "repeats a group that already repeats";
    }
    if (plain.includes("|")) {
      return "repeats a group with alternatives";
    }
  }
  return null;
}

function* patternsIn(schema: unknown, seen = new Set<object>()): Generator<string> {
  if (typeof schema !== "object" || schema === null || seen.has(schema)) return;
  seen.add(schema);
  if (Array.isArray(schema)) {
    for (const item of schema) yield* patternsIn(item, seen);
    return;
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern" && typeof value === "string") {
      yield value;
    } else if (key === "patternProperties" && typeof value === "object" && value !== null) {
      yield* Object.keys(value);
    }
    yield* patternsIn(value, seen);
  }
}

export function unsafePatterns(schema: unknown): string[] {
  const problems: string[] = [];
  for (const pattern of patternsIn(schema)) {
    const reason = unsafePatternReason(pattern);
    if (reason) {
      problems.push(
        `The pattern ${JSON.stringify(pattern.slice(0, 80))} ${reason}, so the runner does not check it.`,
      );
    }
  }
  return problems;
}
