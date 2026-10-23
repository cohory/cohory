import { assertCan, can, type Actor } from "@cohory/authz";

import { CategoryLimitError, CategoryNotFoundError } from "../errors";
import type { CategoryRecord, PostsStore } from "../repository";
import {
  createCategoryInputSchema,
  maxCategories,
  reorderCategoriesInputSchema,
  updateCategoryInputSchema,
  type CreateCategoryInput,
  type ReorderCategoriesInput,
  type UpdateCategoryInput,
} from "../schemas";
import { toCategoryDetailView, type CategoryDetailView } from "../views";
import {
  isUuid,
  parseOrThrow,
  requireUserId,
  withAccess,
  withWriteAccess,
  type Access,
  type Runtime,
} from "./context";

const maxSlugLength = 48;

export const generalCategorySlug = "general";

export function categorySlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxSlugLength)
    .replace(/-+$/g, "");
  return base || "category";
}

export function freeSlug(name: string, taken: ReadonlySet<string>): string {
  const base = categorySlug(name);
  if (!taken.has(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, maxSlugLength - String(suffix).length - 1)}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

export function canPostRestricted(actor: Actor, access: Access): boolean {
  return can(actor, "post_restricted", "category", access.policy());
}

export async function categoryForPost(
  actor: Actor,
  access: Access,
  categoryId: string | null | undefined,
): Promise<CategoryRecord | null> {
  if (!categoryId) {
    return null;
  }
  const category = isUuid(categoryId) ? await access.store.findCategory(categoryId) : null;
  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.staffOnly) {
    assertCan(actor, "post_restricted", "category", access.policy());
  }
  return category;
}

async function loadCategory(store: PostsStore, categoryId: string): Promise<CategoryRecord> {
  const category = isUuid(categoryId) ? await store.findCategory(categoryId) : null;
  if (!category) {
    throw new CategoryNotFoundError();
  }
  return category;
}

function takenSlugs(all: readonly CategoryRecord[], exceptId?: string): Set<string> {
  return new Set(all.filter((c) => c.id !== exceptId).map((c) => c.slug.toLowerCase()));
}

export function createCategoryOperations(runtime: Runtime) {
  return {
    async listCategories(actor: Actor, communityId: string): Promise<CategoryDetailView[]> {
      return withAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "read", "post", access.policy());
        const restricted = canPostRestricted(actor, access);
        return (await access.store.listCategories()).map((category) =>
          toCategoryDetailView(category, restricted),
        );
      });
    },

    async createCategory(
      actor: Actor,
      communityId: string,
      input: CreateCategoryInput,
    ): Promise<CategoryDetailView> {
      requireUserId(actor);
      const parsed = parseOrThrow(createCategoryInputSchema, input);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "manage", "category", access.policy());
        await access.store.lockCategories();
        const all = await access.store.listCategories();
        if (all.length >= maxCategories) {
          throw new CategoryLimitError(maxCategories);
        }
        const created = await access.store.insertCategory({
          id: runtime.newId(),
          name: parsed.name,
          slug: freeSlug(parsed.name, takenSlugs(all)),
          color: parsed.color,
          staffOnly: parsed.staffOnly,
          position: all.reduce((max, c) => Math.max(max, c.position + 1), 0),
        });
        return toCategoryDetailView(created, true);
      });
    },

    async updateCategory(
      actor: Actor,
      communityId: string,
      categoryId: string,
      input: UpdateCategoryInput,
    ): Promise<CategoryDetailView> {
      requireUserId(actor);
      const parsed = parseOrThrow(updateCategoryInputSchema, input);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "manage", "category", access.policy());
        await access.store.lockCategories();
        const current = await loadCategory(access.store, categoryId);
        const renamed = parsed.name !== undefined && parsed.name !== current.name;
        const slug = renamed
          ? freeSlug(
              parsed.name ?? current.name,
              takenSlugs(await access.store.listCategories(), current.id),
            )
          : undefined;
        const updated = await access.store.updateCategory(current.id, {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(parsed.color !== undefined ? { color: parsed.color } : {}),
          ...(parsed.staffOnly !== undefined ? { staffOnly: parsed.staffOnly } : {}),
        });
        if (!updated) {
          throw new CategoryNotFoundError();
        }
        return toCategoryDetailView(updated, true);
      });
    },

    async deleteCategory(actor: Actor, communityId: string, categoryId: string): Promise<void> {
      requireUserId(actor);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "manage", "category", access.policy());
        const category = await loadCategory(access.store, categoryId);
        const general = (await access.store.listCategories()).find(
          (candidate) => candidate.slug === generalCategorySlug && candidate.id !== category.id,
        );
        if (!(await access.store.deleteCategory(category.id, general?.id ?? null))) {
          throw new CategoryNotFoundError();
        }
      });
    },

    async reorderCategories(
      actor: Actor,
      communityId: string,
      input: ReorderCategoriesInput,
    ): Promise<CategoryDetailView[]> {
      requireUserId(actor);
      const { ids } = parseOrThrow(reorderCategoriesInputSchema, input);
      return withWriteAccess(runtime, actor, communityId, async (access) => {
        assertCan(actor, "manage", "category", access.policy());
        await access.store.lockCategories();
        const all = await access.store.listCategories();
        const known = new Set(all.map((c) => c.id));
        if (
          ids.length !== all.length ||
          new Set(ids).size !== ids.length ||
          !ids.every((id) => known.has(id))
        ) {
          throw new CategoryNotFoundError();
        }
        await access.store.setCategoryPositions(ids);
        return (await access.store.listCategories()).map((c) => toCategoryDetailView(c, true));
      });
    },
  };
}
