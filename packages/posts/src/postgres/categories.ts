import { type ScopedQueries } from "@cohory/db";
import { categories, postDrafts, posts } from "@cohory/db/schema";
import { asc, eq, sql } from "drizzle-orm";

import type { PostsStore } from "../repository";

import { requiredCategory } from "./queries";

export function createCategoryStore(
  queries: ScopedQueries,
): Pick<
  PostsStore,
  | "listCategories"
  | "findCategory"
  | "findCategoryBySlug"
  | "lockCategories"
  | "insertCategory"
  | "updateCategory"
  | "deleteCategory"
  | "setCategoryPositions"
> {
  const { tx, where, values, communityId } = queries;

  return {
    listCategories() {
      return tx
        .select()
        .from(categories)
        .where(where(categories))
        .orderBy(asc(categories.position), asc(categories.id));
    },

    async findCategory(categoryId) {
      const [row] = await tx
        .select()
        .from(categories)
        .where(where(categories, eq(categories.id, categoryId)))
        .limit(1);
      return row ?? null;
    },

    async findCategoryBySlug(slug) {
      const [row] = await tx
        .select()
        .from(categories)
        .where(where(categories, sql`${categories.slug} = ${slug}::citext`))
        .limit(1);
      return row ?? null;
    },

    async lockCategories() {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`cohory.posts.categories:${communityId}`}, 0))`,
      );
    },

    async insertCategory(category) {
      const [row] = await tx.insert(categories).values(values(category)).returning();
      return requiredCategory(row);
    },

    async updateCategory(categoryId, patch) {
      const [row] = await tx
        .update(categories)
        .set({ ...patch, updatedAt: new Date() })
        .where(where(categories, eq(categories.id, categoryId)))
        .returning();
      return row ?? null;
    },

    async deleteCategory(categoryId, moveTo) {
      if (moveTo) {
        await tx
          .update(posts)
          .set({ categoryId: moveTo })
          .where(where(posts, eq(posts.categoryId, categoryId)));
        await tx
          .update(postDrafts)
          .set({ categoryId: moveTo })
          .where(where(postDrafts, eq(postDrafts.categoryId, categoryId)));
      }
      const rows = await tx
        .delete(categories)
        .where(where(categories, eq(categories.id, categoryId)))
        .returning({ id: categories.id });
      return rows.length > 0;
    },

    async setCategoryPositions(orderedIds) {
      for (const [position, id] of orderedIds.entries()) {
        await tx
          .update(categories)
          .set({ position, updatedAt: new Date() })
          .where(where(categories, eq(categories.id, id)));
      }
    },
  };
}
