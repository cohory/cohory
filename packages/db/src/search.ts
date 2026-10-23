import { sql, type SQL } from "drizzle-orm";

export const maxSearchTerms = 8;
export const minSearchLength = 2;
export const maxSearchLength = 100;

const highlightStart = "\u0002";
const highlightStop = "\u0003";

export const headlineOptions = `StartSel=${highlightStart}, StopSel=${highlightStop}, MaxWords=24, MinWords=10, ShortWord=2, MaxFragments=2, FragmentDelimiter=" ... "`;

export interface ExcerptSegment {
  readonly text: string;
  readonly match: boolean;
}

export function searchTerms(input: string): string[] {
  const terms = input
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0);
  return [...new Set(terms)].slice(0, maxSearchTerms);
}

export function prefixTsQuery(input: string): string | null {
  const terms = searchTerms(input);
  return terms.length === 0 ? null : terms.map((term) => `${term}:*`).join(" & ");
}

export function tsQuery(prefixQuery: string): SQL {
  return sql`to_tsquery('simple', ${prefixQuery})`;
}

export function splitHighlights(headline: string): ExcerptSegment[] {
  const segments: ExcerptSegment[] = [];
  let rest = headline;
  while (rest.length > 0) {
    const start = rest.indexOf(highlightStart);
    if (start === -1) {
      segments.push({ text: rest, match: false });
      break;
    }
    if (start > 0) {
      segments.push({ text: rest.slice(0, start), match: false });
    }
    const stop = rest.indexOf(highlightStop, start + 1);
    const end = stop === -1 ? rest.length : stop;
    const text = rest.slice(start + 1, end);
    if (text.length > 0) {
      segments.push({ text, match: true });
    }
    rest = stop === -1 ? "" : rest.slice(stop + 1);
  }
  return segments.filter((segment) => segment.text.length > 0);
}
