export const importerIds = ["skool", "circle"] as const;
export type ImporterId = (typeof importerIds)[number];

export const importerMaxFiles = 8;
export const importerMaxBytes = 25 * 1024 * 1024;
export const importerMaxMembers = 20_000;
export const importerMaxPosts = 20_000;
export const importerMaxComments = 100_000;

export interface ImporterLimits {
  readonly id: ImporterId;
  readonly name: string;
  readonly version: string;
  readonly accept: readonly string[];
  readonly limitsPath: string;
  readonly files: readonly { readonly label: string; readonly description: string }[];
  readonly transfers: readonly string[];
  readonly doesNotTransfer: readonly string[];
  readonly sources: readonly { readonly label: string; readonly url: string }[];
  readonly checkedOn: string;
}

const sharedLimits = [
  "Payments, payment methods, and subscriptions. Paying members join as regular members.",
  "Likes by identity. Exports have like counts, not who liked.",
  "Private messages and chat.",
  "Uploaded images, files, and video. YouTube, Vimeo, Loom, and Wistia links become embeds.",
  "Events, avatars, passwords, and notification settings.",
] as const;

const safety = `Up to ${importerMaxFiles} files and 25 MB per upload, ${importerMaxMembers.toLocaleString("en")} members, ${importerMaxPosts.toLocaleString("en")} posts, and ${importerMaxComments.toLocaleString("en")} comments.`;

export const importerCatalog: Readonly<Record<ImporterId, ImporterLimits>> = {
  skool: {
    id: "skool",
    name: "Skool",
    version: "1.0.0",
    accept: [".csv", ".json"],
    limitsPath: "/importers/skool",
    files: [
      {
        label: "Members CSV",
        description: "From the Export button in the Members tab of your Skool admin panel.",
      },
      {
        label: "Posts JSON (optional)",
        description:
          "Skool has no content export. Some creators save posts and comments with a third party tool; the importer reads the common JSON shape.",
      },
      {
        label: "Comments JSON (optional)",
        description: "Comments saved in a separate file, linked to posts by id or URL.",
      },
    ],
    transfers: [
      "Members with name, email, join date, and join answers",
      "Points, with levels from cohory's thresholds",
      "Admins and moderators when the file has a role column",
      "Post categories, up to 10",
      "Posts and comments, with formatting kept and everything unsafe removed",
    ],
    doesNotTransfer: [
      ...sharedLimits,
      "The classroom: courses, lessons, and progress. Skool has no classroom export.",
      "Posts by people missing from the members CSV keep the author name, marked as former member, with no account to sign in to.",
    ],
    sources: [
      {
        label: "Skool members CSV header",
        url: "https://skool-api.cristiantala.com/recipes/export-skool-members-csv/",
      },
      {
        label: "Skool posts scraper output",
        url: "https://apify.com/scrapersdelight/skool-posts-scraper/examples/export-skool-posts-json",
      },
    ],
    checkedOn: "2026-10-18",
  },
  circle: {
    id: "circle",
    name: "Circle",
    version: "1.0.0",
    accept: [".csv", ".json"],
    limitsPath: "/importers/circle",
    files: [
      {
        label: "Members CSV",
        description:
          "From Audience, Manage audience, More, Export CSV, or the Members file of the community data export.",
      },
      {
        label: "Spaces, Posts, and Comments CSV",
        description:
          "The other files of the community data export, which Circle support sends on request.",
      },
      {
        label: "Posts and comments JSON (optional)",
        description: "Records saved from the Circle Admin API.",
      },
    ],
    transfers: [
      "Members with name, email, join date, last active date, and headline",
      "Admins and moderators when the file says so",
      "Spaces as categories, up to 10",
      "Posts and comments, with formatting kept and everything unsafe removed",
    ],
    doesNotTransfer: [
      ...sharedLimits,
      "Courses, lessons, and progress. Circle's exports do not include them.",
      "Tags, custom profile fields, and space privacy settings.",
      "Posts by people missing from the members CSV keep the author name, marked as former member, with no account to sign in to.",
    ],
    sources: [
      {
        label: "Circle community data export",
        url: "https://help.circle.so/p/administration/analytics/export-your-community-data",
      },
      {
        label: "Circle members CSV",
        url: "https://help.circle.so/c/data-analytics/how-do-i-export-a-csv-of-my-members",
      },
      { label: "Circle Admin API", url: "https://api.circle.so/apis/admin-api.md" },
    ],
    checkedOn: "2026-10-18",
  },
};

export const importerSafetyNote = `Files are read as data and never run. ${safety}`;

export function isImporterId(value: string): value is ImporterId {
  return (importerIds as readonly string[]).includes(value);
}
