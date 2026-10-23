"use server";

import { requireSession } from "@cohory/auth/next";
import type { Actor } from "@cohory/authz";
import {
  CommunityCreationRestrictedError,
  CommunityNotFoundError,
  CommunityValidationError,
  getCommunitiesService,
  reservedSlugs,
  SlugReservedError,
  SlugTakenError,
} from "@cohory/communities";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actorFor } from "../../../../lib/actor";
import {
  checkSlugAvailability,
  type SlugAvailability,
} from "../../../../lib/communities/slug-availability";
import {
  communitySlugField,
  createCommunityFormSchema,
  creationClosedMessage,
  type CreateCommunityField,
} from "./schema";

export interface CreateCommunityValues {
  description: string;
  privacy: string;
  pricing: string;
}

export type CreateCommunityState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors: Partial<Record<CreateCommunityField, string>>;
      message?: string;
      values: CreateCommunityValues;
    };

const fields: readonly CreateCommunityField[] = [
  "name",
  "slug",
  "description",
  "privacy",
  "pricing",
];

function isField(value: unknown): value is CreateCommunityField {
  return fields.some((name) => name === value);
}

function field(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export async function createCommunityAction(
  _previous: CreateCommunityState,
  formData: FormData,
): Promise<CreateCommunityState> {
  const session = await requireSession("/communities/new");
  const values: CreateCommunityValues = {
    description: field(formData.get("description")),
    privacy: field(formData.get("privacy")),
    pricing: field(formData.get("pricing")),
  };
  const parsed = createCommunityFormSchema.safeParse({
    name: field(formData.get("name")),
    slug: field(formData.get("slug")),
    ...values,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<CreateCommunityField, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (isField(key) && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { status: "error", fieldErrors, values };
  }
  const { pricing, ...input } = parsed.data;

  try {
    await getCommunitiesService().createCommunity(actorFor(session), input);
  } catch (error) {
    if (error instanceof CommunityCreationRestrictedError) {
      return { status: "error", fieldErrors: {}, message: creationClosedMessage, values };
    }
    if (error instanceof SlugTakenError) {
      return {
        status: "error",
        fieldErrors: { slug: "That URL is already taken. Try a different one." },
        values,
      };
    }
    if (error instanceof SlugReservedError) {
      return {
        status: "error",
        fieldErrors: { slug: "That URL is reserved. Try a different one." },
        values,
      };
    }
    if (error instanceof CommunityValidationError) {
      return {
        status: "error",
        fieldErrors: {},
        message: "Some fields are not valid. Check them and try again.",
        values,
      };
    }
    throw error;
  }

  revalidatePath("/");
  redirect(
    pricing === "paid" ? `/c/${input.slug}/manage/payments?setup=connect` : `/c/${input.slug}`,
  );
}

async function slugInUse(actor: Actor, slug: string): Promise<boolean> {
  const service = getCommunitiesService();
  if (await service.findMovedSlug(slug)) {
    return true;
  }
  try {
    await service.getCommunityBySlug(actor, slug);
    return true;
  } catch (error) {
    if (error instanceof CommunityNotFoundError) {
      return false;
    }
    throw error;
  }
}

export async function checkSlugAction(slug: string): Promise<SlugAvailability | null> {
  const session = await requireSession("/communities/new");
  const parsed = communitySlugField.safeParse(slug);
  if (!parsed.success) {
    return null;
  }
  const actor = actorFor(session);
  return checkSlugAvailability(parsed.data, {
    isReserved: (candidate) => reservedSlugs.has(candidate),
    inUse: (candidate) => slugInUse(actor, candidate),
  });
}
