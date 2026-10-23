"use server";

import { getPostsService } from "@cohory/api/services";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveCommunity } from "../posts/context";
import { failure, type ActionResult } from "../posts/errors";
import { manageActionFailure } from "./errors";

const slug = z.string().min(1).max(64);
const color = z.enum(["neutral", "accent", "info", "success", "warning", "danger"]);
const name = z
  .string()
  .trim()
  .min(1, "Give the category a name.")
  .max(40, "Keep category names to 40 characters or fewer.");

const createSchema = z.object({ slug, name, color, staffOnly: z.boolean() });
const updateSchema = z.object({ slug, categoryId: z.uuid(), name, color, staffOnly: z.boolean() });
const deleteSchema = z.object({ slug, categoryId: z.uuid() });
const reorderSchema = z.object({ slug, ids: z.array(z.uuid()).min(1).max(10) });

async function run<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  fn: (input: z.output<S>, context: Awaited<ReturnType<typeof resolveCommunity>>) => Promise<void>,
): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "Check the category and try again.");
  }
  try {
    const input: z.output<S> = parsed.data;
    const context = await resolveCommunity((input as { slug: string }).slug);
    await fn(input, context);
    revalidatePath(`/c/${context.slug}`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}

export async function createCategoryAction(raw: z.input<typeof createSchema>) {
  return run(createSchema, raw, async (input, context) => {
    await getPostsService().createCategory(context.access.actor, context.communityId, {
      name: input.name,
      color: input.color,
      staffOnly: input.staffOnly,
    });
  });
}

export async function updateCategoryAction(raw: z.input<typeof updateSchema>) {
  return run(updateSchema, raw, async (input, context) => {
    await getPostsService().updateCategory(
      context.access.actor,
      context.communityId,
      input.categoryId,
      { name: input.name, color: input.color, staffOnly: input.staffOnly },
    );
  });
}

export async function deleteCategoryAction(raw: z.input<typeof deleteSchema>) {
  return run(deleteSchema, raw, async (input, context) => {
    await getPostsService().deleteCategory(
      context.access.actor,
      context.communityId,
      input.categoryId,
    );
  });
}

export async function reorderCategoriesAction(raw: z.input<typeof reorderSchema>) {
  return run(reorderSchema, raw, async (input, context) => {
    await getPostsService().reorderCategories(context.access.actor, context.communityId, {
      ids: input.ids,
    });
  });
}
