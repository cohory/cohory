import { getReviewsService } from "@cohory/reviews";
import type { ReactNode } from "react";

import { ReviewsSection } from "../../components/reviews/reviews-section";
import type { CommunityPage } from "../communities/load";
import { reviewAudience, showReviews } from "./audience";

export interface ReviewSlots {
  readonly reviews?: ReactNode;
}

export async function loadReviewSlots(
  page: CommunityPage,
  { preview }: { readonly preview: boolean } = { preview: false },
): Promise<ReviewSlots> {
  const summary = await getReviewsService().getSummary(page.actor, page.community.id);
  if (summary.status === "disabled") {
    return {};
  }
  const audience = reviewAudience({
    member: page.access === "full" && page.role !== null,
    preview,
  });
  if (!showReviews(audience, summary.count)) {
    return {};
  }
  return { reviews: <ReviewsSection slug={page.community.slug} audience={audience} /> };
}
