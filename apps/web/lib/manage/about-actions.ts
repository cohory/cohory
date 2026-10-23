"use server";

import { getManageService, type GalleryItemView } from "@cohory/communities";
import {
  faqAnswerMaxLength,
  faqQuestionMaxLength,
  hostBioMaxLength,
  hostCredentialMaxLength,
  maxFaqItems,
  maxWhatYouGetItems,
  whatYouGetItemMaxLength,
} from "@cohory/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toContentDocument } from "../posts/document";
import { resolveCommunity } from "../posts/context";
import { postDocumentSchema } from "../posts/schemas";
import { failure, type ActionResult } from "../posts/errors";
import { manageActionFailure } from "./errors";

const slug = z.string().min(1).max(64);
const itemId = z.uuid();
const altText = z.string().trim().max(250, "Use 250 characters or fewer.");

class ActionInputError extends Error {}

async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ActionInputError) return failure(error.message);
    const result = manageActionFailure(error);
    if (result) return result;
    throw error;
  }
}

async function context(rawSlug: string) {
  const resolved = await resolveCommunity(slug.parse(rawSlug));
  return { actor: resolved.access.actor, id: resolved.communityId, slug: resolved.slug };
}

function refresh(communitySlug: string): void {
  revalidatePath(`/c/${communitySlug}`, "layout");
}

const anyDocument = z.object({ type: z.literal("doc"), content: z.array(z.unknown()).max(500) });

const aboutText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max.toLocaleString("en-US")} characters or fewer.`);

const aboutInputSchema = z.object({
  description: aboutText(2000),
  whatYouGet: z
    .array(aboutText(whatYouGetItemMaxLength))
    .max(maxWhatYouGetItems)
    .transform((lines) => lines.filter((line) => line !== "")),
  hostBio: aboutText(hostBioMaxLength),
  hostCredential: aboutText(hostCredentialMaxLength),
  faq: z
    .array(z.object({ q: aboutText(faqQuestionMaxLength), a: aboutText(faqAnswerMaxLength) }))
    .max(maxFaqItems)
    .transform((items) => items.filter((item) => item.q !== "" || item.a !== "")),
  document: z.unknown(),
});

export type SaveAboutInput = z.input<typeof aboutInputSchema>;

export async function saveAboutAction(
  rawSlug: string,
  raw: SaveAboutInput,
): Promise<ActionResult<null>> {
  return guard(async () => {
    const input = aboutInputSchema.parse(raw);
    if (input.faq.some((item) => item.q === "" || item.a === "")) {
      throw new ActionInputError("Give every question an answer, or remove it.");
    }
    const community = await context(rawSlug);
    const empty = anyDocument.parse(input.document).content.length === 0;
    await getManageService().updateAbout(community.actor, community.id, {
      description: input.description,
      whatYouGet: input.whatYouGet,
      hostBio: input.hostBio,
      hostCredential: input.hostCredential,
      faq: input.faq,
      detailedDescription: empty
        ? null
        : toContentDocument(postDocumentSchema.parse(input.document)),
    });
    refresh(community.slug);
    return null;
  });
}

export async function addGalleryImageAction(
  rawSlug: string,
  formData: FormData,
): Promise<ActionResult<GalleryItemView[]>> {
  return guard(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ActionInputError("Choose an image to upload.");
    }
    const alt = altText.parse(formData.get("altText") ?? "");
    const community = await context(rawSlug);
    const items = await getManageService().addGalleryImage(
      community.actor,
      community.id,
      { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type },
      alt,
    );
    refresh(community.slug);
    return items;
  });
}

export async function addGalleryVideoAction(
  rawSlug: string,
  raw: { url: string },
): Promise<ActionResult<GalleryItemView[]>> {
  return guard(async () => {
    const url = z.string().trim().max(2048).parse(raw.url);
    if (url === "") throw new ActionInputError("Paste a YouTube, Vimeo, or Loom link.");
    const community = await context(rawSlug);
    const items = await getManageService().addGalleryVideo(community.actor, community.id, { url });
    refresh(community.slug);
    return items;
  });
}

export async function updateGalleryAltTextAction(
  rawSlug: string,
  raw: { itemId: string; altText: string },
): Promise<ActionResult<GalleryItemView[]>> {
  return guard(async () => {
    const community = await context(rawSlug);
    const items = await getManageService().updateGalleryItem(
      community.actor,
      community.id,
      itemId.parse(raw.itemId),
      { altText: altText.parse(raw.altText) },
    );
    refresh(community.slug);
    return items;
  });
}

export async function reorderGalleryAction(
  rawSlug: string,
  itemIds: readonly string[],
): Promise<ActionResult<GalleryItemView[]>> {
  return guard(async () => {
    const community = await context(rawSlug);
    const items = await getManageService().reorderGallery(community.actor, community.id, {
      itemIds: z.array(itemId).max(10).parse(itemIds),
    });
    refresh(community.slug);
    return items;
  });
}

export async function removeGalleryItemAction(
  rawSlug: string,
  rawItemId: string,
): Promise<ActionResult<GalleryItemView[]>> {
  return guard(async () => {
    const community = await context(rawSlug);
    const items = await getManageService().removeGalleryItem(
      community.actor,
      community.id,
      itemId.parse(rawItemId),
    );
    refresh(community.slug);
    return items;
  });
}
