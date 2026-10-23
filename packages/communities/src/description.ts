import {
  ContentValidationError,
  contentDocumentSchema,
  parseContent,
  replaceUnresolvedMentions,
  type ContentDocument,
} from "@cohory/content";

import { CommunityValidationError } from "./errors";

export function parseDetailedDescription(input: unknown): ContentDocument {
  try {
    return replaceUnresolvedMentions(parseContent(input, { allowImages: false }), new Set());
  } catch (error: unknown) {
    if (error instanceof ContentValidationError) {
      throw new CommunityValidationError(
        error.issues.map((issue) => ({
          path: issue.path.replace(/^body/, "detailedDescription"),
          message: issue.message,
        })),
      );
    }
    throw error;
  }
}

export function storedDetailedDescription(value: unknown): ContentDocument | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = contentDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
