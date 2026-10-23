"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

const slugSchema = z.string().min(1).max(64);

export async function refreshCommunityAction(raw: string): Promise<void> {
  const slug = slugSchema.safeParse(raw);
  if (!slug.success) return;
  revalidatePath(`/c/${slug.data}`, "layout");
}
