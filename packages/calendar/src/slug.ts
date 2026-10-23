export const maxSlugLength = 60;

export const reservedSlugs: ReadonlySet<string> = new Set([
  "new",
  "edit",
  "create",
  "settings",
  "manage",
  "ics",
  "occurrences",
  "upcoming",
]);

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxSlugLength)
    .replace(/-+$/g, "");
}

export function nextFreeSlug(base: string, taken: readonly string[]): string {
  const root = base || "event";
  const used = new Set(taken.map((slug) => slug.toLowerCase()));
  if (!used.has(root) && !reservedSlugs.has(root)) {
    return root;
  }
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${root.slice(0, maxSlugLength - tail.length).replace(/-+$/g, "")}${tail}`;
    if (!used.has(candidate) && !reservedSlugs.has(candidate)) {
      return candidate;
    }
  }
}
