import { contentTypeForKey, isStorageKey } from "@cohory/storage";

import { CalendarValidationError } from "../errors";

const coverTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function checkCoverKey(communityId: string, key: string | null | undefined): void {
  if (key === null || key === undefined) {
    return;
  }
  const valid =
    isStorageKey(key) &&
    key.startsWith(`communities/${communityId}/`) &&
    coverTypes.has(contentTypeForKey(key) ?? "");
  if (!valid) {
    throw new CalendarValidationError([
      { path: "coverKey", message: "Upload the cover image to this community first." },
    ]);
  }
}
