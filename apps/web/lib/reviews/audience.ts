import { eligibilityRuleText } from "@cohory/reviews";

export type ReviewAudience = "member" | "visitor" | "preview";

export function reviewAudience({
  member,
  preview,
}: {
  readonly member: boolean;
  readonly preview: boolean;
}): ReviewAudience {
  if (preview) {
    return "preview";
  }
  return member ? "member" : "visitor";
}

export function showReviews(audience: ReviewAudience, count: number): boolean {
  return audience !== "visitor" || count > 0;
}

export function emptyReviewsLine(audience: ReviewAudience): string {
  return audience === "preview"
    ? "No reviews yet. Visitors see this section once there is a review."
    : "No reviews yet.";
}

export function reviewRuleLine(audience: ReviewAudience): string {
  return audience === "member"
    ? eligibilityRuleText
    : "Every review is from a member who has paid for at least 30 days.";
}
