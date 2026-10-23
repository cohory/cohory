export type SlugAvailability =
  | { readonly status: "available" }
  | { readonly status: "taken" | "reserved"; readonly suggestions: readonly string[] };

export interface SlugLookup {
  readonly isReserved: (slug: string) => boolean;
  readonly inUse: (slug: string) => Promise<boolean>;
}

const maxSlugLength = 48;
const suggestionCount = 3;
const suffixes = ["community", "hq", "club", "online"] as const;

function fit(base: string, room: number): string {
  return base.slice(0, Math.max(0, maxSlugLength - room)).replace(/-+$/, "");
}

export function slugCandidates(slug: string): string[] {
  return [
    ...suffixes.map((suffix) => `${fit(slug, suffix.length + 1)}-${suffix}`),
    `join-${fit(slug, 5)}`,
    `${fit(slug, 2)}-2`,
    `${fit(slug, 2)}-3`,
  ];
}

export async function checkSlugAvailability(
  slug: string,
  lookup: SlugLookup,
): Promise<SlugAvailability> {
  const reserved = lookup.isReserved(slug);
  if (!reserved && !(await lookup.inUse(slug))) {
    return { status: "available" };
  }
  const candidates = slugCandidates(slug).filter((candidate) => !lookup.isReserved(candidate));
  const used = await Promise.all(candidates.map((candidate) => lookup.inUse(candidate)));
  return {
    status: reserved ? "reserved" : "taken",
    suggestions: candidates.filter((_, index) => !used[index]).slice(0, suggestionCount),
  };
}
