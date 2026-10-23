const invisibleRanges: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];

function isInvisible(codePoint: number): boolean {
  return invisibleRanges.some(([from, to]) => codePoint >= from && codePoint <= to);
}

export function stripInvisible(text: string): string {
  let result = "";
  for (const character of text) {
    if (!isInvisible(character.codePointAt(0) ?? 0)) {
      result += character;
    }
  }
  return result;
}

export function stripInvisibleDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return stripInvisible(value);
  }
  if (Array.isArray(value)) {
    return value.map(stripInvisibleDeep);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripInvisibleDeep(entry)]),
    );
  }
  return value;
}
