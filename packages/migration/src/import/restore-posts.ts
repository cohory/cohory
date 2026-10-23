import { newId } from "@cohory/db";
import { categories, comments, postImages, posts, reactions } from "@cohory/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { importContent } from "./content";
import type { MappedId } from "./id-map";
import { chunks, date, dateOrNull, restoreBatchSize, type RestoreContext } from "./restore-context";

export async function restoreCategories(ctx: RestoreContext): Promise<void> {
  const { records, target, map, scope, progress } = ctx;
  const existingCategories = await scope((tx) =>
    tx
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(eq(categories.communityId, target)),
  );
  const categoryBySlug = new Map(existingCategories.map((row) => [row.slug.toLowerCase(), row.id]));
  for (const batch of chunks(records.categories, restoreBatchSize)) {
    const pending = batch.filter((row) => !map.has("categories", row.id));
    if (pending.length > 0) {
      const entries: MappedId[] = [];
      await scope(async (tx) => {
        for (const row of pending) {
          const fields = {
            name: row.name,
            color: row.color,
            position: row.position,
            staffOnly: row.staffOnly,
          };
          const existingId = categoryBySlug.get(row.slug.toLowerCase());
          if (existingId) {
            await tx
              .update(categories)
              .set(fields)
              .where(and(eq(categories.communityId, target), eq(categories.id, existingId)));
            entries.push({ entity: "categories", sourceId: row.id, targetId: existingId });
            continue;
          }
          const id = newId();
          await tx.insert(categories).values({
            id,
            communityId: target,
            slug: row.slug,
            createdAt: date(row.createdAt),
            ...fields,
          });
          categoryBySlug.set(row.slug.toLowerCase(), id);
          entries.push({ entity: "categories", sourceId: row.id, targetId: id });
        }
        await map.persist(tx, entries);
      });
      for (const entry of entries) map.remember(entry);
    }
    await progress("categories", batch.length);
  }
}

export async function restorePosts(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, phase, user, contentRewrite, imageUrl, rewriteKey } = ctx;
  await phase(
    "posts",
    records.posts,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const authorId = user(row.authorId);
        if (!authorId) {
          skips.add("posts", row.id, "The author is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        const content = importContent(row.body, contentRewrite, { allowImages: true, imageUrl });
        if (!content.ok) {
          skips.add("posts", row.id, content.reason);
          skipped.add(row.id);
          continue;
        }
        values.push({
          id,
          communityId: target,
          authorId,
          categoryId: map.get("categories", row.categoryId) ?? null,
          title: row.title,
          body: content.content.body,
          bodyHtml: content.content.bodyHtml,
          bodyText: content.content.bodyText,
          excerpt: content.content.excerpt,
          lastActivityAt: date(row.lastActivityAt),
          pinnedAt: dateOrNull(row.pinnedAt),
          scheduledAt: dateOrNull(row.scheduledAt ?? null),
          editedAt: dateOrNull(row.editedAt),
          deletedAt: dateOrNull(row.deletedAt),
          deletedBy: user(row.deletedBy) ?? null,
          createdAt: date(row.createdAt),
          updatedAt: date(row.updatedAt),
        });
      }
      if (values.length > 0) {
        await tx.insert(posts).values(values);
      }
      return skipped;
    },
  );

  await phase(
    "post_images",
    records.post_images,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const postId = map.get("posts", row.postId);
        const storageKey = rewriteKey(row.storageKey);
        if (!postId || !storageKey) {
          skips.add("post_images", row.id, "The post or the file is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        values.push({
          id,
          communityId: target,
          postId,
          storageKey,
          width: row.width,
          height: row.height,
          position: row.position,
        });
      }
      if (values.length > 0) {
        await tx.insert(postImages).values(values).onConflictDoNothing();
      }
      return skipped;
    },
  );
}

export async function restoreComments(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, scope, phase, user, contentRewrite, imageUrl } = ctx;
  await phase(
    "comments",
    records.comments,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const postId = map.get("posts", row.postId);
        const authorId = user(row.authorId);
        if (!postId || !authorId) {
          skips.add("comments", row.id, "The post or the author is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        const content = importContent(row.body, contentRewrite, { allowImages: false, imageUrl });
        if (!content.ok) {
          skips.add("comments", row.id, content.reason);
          skipped.add(row.id);
          continue;
        }
        values.push({
          id,
          communityId: target,
          postId,
          authorId,
          parentId: null,
          body: content.content.body,
          bodyHtml: content.content.bodyHtml,
          bodyText: content.content.bodyText,
          editedAt: dateOrNull(row.editedAt),
          deletedAt: dateOrNull(row.deletedAt),
          deletedBy: user(row.deletedBy) ?? null,
          createdAt: date(row.createdAt),
          updatedAt: date(row.updatedAt),
        });
      }
      if (values.length > 0) {
        await tx.insert(comments).values(values);
      }
      return skipped;
    },
  );
  const threaded = records.comments.filter((row) => row.parentId !== null);
  for (const batch of chunks(threaded, restoreBatchSize)) {
    await scope(async (tx) => {
      for (const row of batch) {
        const id = map.get("comments", row.id);
        const parentId = map.get("comments", row.parentId);
        if (!id) continue;
        if (!parentId) {
          skips.add("comments.parent", row.id, "The parent comment is not in the archive.");
          continue;
        }
        await tx
          .update(comments)
          .set({ parentId })
          .where(and(eq(comments.communityId, target), eq(comments.id, id)));
      }
    });
  }
}

export async function restoreReactions(ctx: RestoreContext): Promise<void> {
  const { records, target, map, skips, phase, user } = ctx;
  await phase(
    "reactions",
    records.reactions,
    (row) => row.id,
    async (tx, items) => {
      const skipped = new Set<string>();
      const values = [];
      for (const { row, id } of items) {
        const subjectId = map.get(row.subjectType === "post" ? "posts" : "comments", row.subjectId);
        const userId = user(row.userId);
        const subjectAuthorId = user(row.subjectAuthorId);
        if (!subjectId || !userId || !subjectAuthorId) {
          skips.add("reactions", row.id, "The liked item or the person is not in the archive.");
          skipped.add(row.id);
          continue;
        }
        values.push({
          id,
          communityId: target,
          userId,
          subjectType: row.subjectType,
          subjectId,
          subjectAuthorId,
          kind: row.kind,
          createdAt: date(row.createdAt),
        });
      }
      if (values.length > 0) {
        await tx.insert(reactions).values(values).onConflictDoNothing();
      }
      return skipped;
    },
  );
}

/** The archive's counters are not trusted: they are recounted from the rows that made it in. */
export async function recountPostCounters(ctx: RestoreContext): Promise<void> {
  const { target, scope } = ctx;
  await scope(async (tx) => {
    await tx.execute(sql`
      update ${posts} set
        comment_count = (select count(*)::int from ${comments} c where c.post_id = ${posts.id} and c.deleted_at is null),
        like_count = (select count(*)::int from ${reactions} r where r.subject_type = 'post' and r.subject_id = ${posts.id})
      where ${posts.communityId} = ${target}`);
    await tx.execute(sql`
      update ${comments} set
        like_count = (select count(*)::int from ${reactions} r where r.subject_type = 'comment' and r.subject_id = ${comments.id})
      where ${comments.communityId} = ${target}`);
  });
}
