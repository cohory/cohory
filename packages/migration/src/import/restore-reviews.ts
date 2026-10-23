import { reviewReplies, reviews } from "@cohory/db/schema";

import { date, dateOrNull, type RestoreContext } from "./restore-context";

export async function restoreReviews(ctx: RestoreContext): Promise<void> {
  const { input, records, target, map, skips, phase, user } = ctx;
  await phase(
    "reviews",
    records.reviews,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const authorId = row.authorId ? user(row.authorId) : undefined;
        if (row.authorId && !authorId) {
          skips.add("reviews", row.id, "The person is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        if (!authorId && !row.anonymizedAt) {
          skips.add("reviews", row.id, "The review has no author.");
          skipped.add(row.id);
          continue;
        }
        const inserted = await tx
          .insert(reviews)
          .values({
            id,
            communityId: target,
            authorId: authorId ?? null,
            rating: row.rating,
            body: row.body,
            editedAt: dateOrNull(row.editedAt),
            hiddenAt: dateOrNull(row.hiddenAt),
            hiddenReason: row.hiddenReason,
            hiddenBy: user(row.hiddenBy) ?? null,
            authorRemovedAt: dateOrNull(row.authorRemovedAt),
            anonymizedAt: dateOrNull(row.anonymizedAt),
            createdAt: date(row.createdAt),
          })
          .onConflictDoNothing()
          .returning({ id: reviews.id });
        if (inserted.length === 0) {
          skips.add("reviews", row.id, "The person already reviewed this community.");
          skipped.add(row.id);
        }
      }
      return skipped;
    },
  );

  await phase(
    "review_replies",
    records.review_replies,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      for (const { row, id } of items) {
        const reviewId = map.get("reviews", row.reviewId);
        if (!reviewId) {
          skips.add("review_replies", row.id, "The review is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        await tx
          .insert(reviewReplies)
          .values({
            id,
            communityId: target,
            reviewId,
            authorId: user(row.authorId) ?? input.ownerUserId,
            body: row.body,
            editedAt: dateOrNull(row.editedAt),
            createdAt: date(row.createdAt),
          })
          .onConflictDoNothing();
      }
      return skipped;
    },
  );
}
