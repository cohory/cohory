import type { ImporterContext } from "./types";

export function importerTestContext(): ImporterContext {
  let counter = 0;
  return {
    community: { id: "01900000-0000-7000-8000-0000000000aa", slug: "makers", name: "Makers" },
    existingCategories: [
      { slug: "general", name: "General", color: "neutral", position: 0, staffOnly: false },
      {
        slug: "announcements",
        name: "Announcements",
        color: "accent",
        position: 2,
        staffOnly: true,
      },
    ],
    now: new Date("2026-10-18T12:00:00.000Z"),
    newId: () => `01900000-0000-7000-8000-${String((counter += 1)).padStart(12, "0")}`,
  };
}
