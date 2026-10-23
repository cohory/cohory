import { getReviewsService } from "@cohory/reviews";

import { loadCommunityPage } from "../../lib/communities/load";
import { emptyReviewsLine, reviewRuleLine, type ReviewAudience } from "../../lib/reviews/audience";
import {
  averageLabel,
  hiddenLines,
  reviewCountLabel,
  toReviewPageRows,
} from "../../lib/reviews/views";
import { ReviewForm } from "./review-form";
import { ReviewList } from "./review-list";
import { Stars } from "./stars";

export async function ReviewsSection({
  slug,
  audience,
}: {
  slug: string;
  audience: ReviewAudience;
}) {
  const page = await loadCommunityPage(slug);
  const service = getReviewsService();
  const communityId = page.community.id;
  const [summary, viewer, first] = await Promise.all([
    service.getSummary(page.actor, communityId),
    service.getViewerState(page.actor, communityId),
    service.listReviews(page.actor, communityId),
  ]);
  if (summary.status === "disabled") {
    return null;
  }
  const viewerId = page.actor.kind === "user" ? page.actor.userId : null;
  const own = viewer.ownReview;
  const initial = toReviewPageRows(first, viewerId);
  const listKey = [
    summary.count,
    ...initial.rows.map(
      (row) => `${row.id}:${row.rating}:${row.body.length}:${row.edited}:${row.reply?.body ?? ""}`,
    ),
  ].join("|");
  const canWrite = viewer.eligibility?.eligible === true && own === null;

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="flex scroll-mt-20 flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h3 id="reviews-heading" className="text-xl text-text">
          Reviews
        </h3>
        {summary.count === 0 ? (
          <p className="text-sm text-text-muted">{emptyReviewsLine(audience)}</p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {summary.average !== null ? (
              <>
                <Stars
                  rating={summary.average}
                  label={`Rated ${averageLabel(summary.average)} out of 5`}
                />
                <span className="font-medium text-text">{averageLabel(summary.average)}</span>
              </>
            ) : null}
            <span>{reviewCountLabel(summary.count)}</span>
          </p>
        )}
        {hiddenLines(summary).map((line) => (
          <p key={line} className="text-sm text-text-muted">
            {line}
          </p>
        ))}
      </div>
      {own ? (
        <ReviewForm
          slug={page.community.slug}
          existing={{
            id: own.id,
            rating: own.rating,
            body: own.body,
            hiddenReason: own.hiddenReason,
          }}
        />
      ) : canWrite ? (
        <ReviewForm slug={page.community.slug} existing={null} />
      ) : audience === "member" && viewer.signedIn && viewer.eligibilityMessage ? (
        <p className="rounded-md bg-surface-raised p-3 text-sm text-text-muted">
          {viewer.eligibilityMessage}
        </p>
      ) : (
        <p className="text-sm text-text-muted">{reviewRuleLine(audience)}</p>
      )}
      <ReviewList
        key={listKey}
        slug={page.community.slug}
        initial={initial}
        ratings={summary.ratings.map((row) => ({ rating: row.rating, count: row.count }))}
        canReply={viewer.canReply}
        canReport={viewer.canReport}
      />
    </section>
  );
}
