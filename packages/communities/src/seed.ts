import { readFile } from "node:fs/promises";

import type { Actor } from "@cohory/authz";
import { getCommunityBySlug, type CommunitySlug, type Database } from "@cohory/db";
import { users } from "@cohory/db/schema";
import { devPaidSeed, devSeed } from "@cohory/db/seed";
import type { StorageDriver } from "@cohory/storage";
import { eq } from "drizzle-orm";

import { createPostgresManageRepository } from "./manage/postgres-repository";
import type { UpdateAboutInput } from "./manage/schemas";
import { createManageService, type ManageService } from "./manage/service";
import { creatorsAbout, creatorsGallery, creatorsJoinQuestions, proAbout } from "./seed-content";

export interface SeededCommunityResult {
  aboutWritten: boolean;
  logoUploaded: boolean;
  coverUploaded: boolean;
  galleryAdded: number;
  joinQuestionsWritten: boolean;
}

export interface CommunitySeedResult {
  creators: SeededCommunityResult;
  pro: SeededCommunityResult;
}

export const devLogoPath = new URL("./seed-assets/cohory-logo.png", import.meta.url);

function seedAsset(file: string): URL {
  return new URL(`./seed-assets/${file}`, import.meta.url);
}

interface CommunityBranding {
  readonly slug: CommunitySlug;
  readonly about: UpdateAboutInput;
  readonly logo: URL;
  readonly cover: URL;
  readonly gallery: readonly { readonly file: string; readonly altText: string }[];
  readonly joinQuestions: readonly { readonly text: string; readonly required: boolean }[];
}

const creators: CommunityBranding = {
  slug: devSeed.communitySlug,
  about: creatorsAbout,
  logo: devLogoPath,
  cover: seedAsset("cohory-creators-cover.png"),
  gallery: creatorsGallery,
  joinQuestions: creatorsJoinQuestions,
};

const pro: CommunityBranding = {
  slug: devPaidSeed.communitySlug,
  about: proAbout,
  logo: seedAsset("cohory-pro-logo.png"),
  cover: seedAsset("cohory-pro-cover.png"),
  gallery: [],
  joinQuestions: [],
};

async function png(url: URL) {
  return { bytes: new Uint8Array(await readFile(url)), declaredType: "image/png" };
}

async function brand(
  db: Database,
  service: ManageService,
  actor: Actor,
  branding: CommunityBranding,
): Promise<SeededCommunityResult> {
  const community = await getCommunityBySlug(db, branding.slug);
  if (!community) {
    throw new Error("run the base seed before seeding community branding");
  }
  const aboutWritten = community.detailedDescription === null;
  if (aboutWritten) {
    await service.updateAbout(actor, community.id, branding.about);
  }
  const joinQuestionsWritten =
    branding.joinQuestions.length > 0 && (community.joinQuestions ?? []).length === 0;
  if (joinQuestionsWritten) {
    await service.updateSettings(actor, community.id, {
      joinQuestions: [...branding.joinQuestions],
    });
  }
  const logoUploaded = !community.appearance.logoKey;
  if (logoUploaded) {
    await service.uploadBranding(actor, community.id, "logo", await png(branding.logo));
  }
  const coverUploaded = !community.appearance.coverKey;
  if (coverUploaded) {
    await service.uploadBranding(actor, community.id, "cover", await png(branding.cover));
  }
  let galleryAdded = 0;
  if ((await service.listGallery(community.id)).length === 0) {
    for (const item of branding.gallery) {
      await service.addGalleryImage(
        actor,
        community.id,
        await png(seedAsset(item.file)),
        item.altText,
      );
      galleryAdded += 1;
    }
  }
  return { aboutWritten, logoUploaded, coverUploaded, galleryAdded, joinQuestionsWritten };
}

export async function seedDevCommunity(
  db: Database,
  storage: Pick<StorageDriver, "put" | "delete" | "publicUrl" | "usedBytes">,
): Promise<CommunitySeedResult> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, devSeed.email))
    .limit(1);
  if (!owner) {
    throw new Error("run the base seed before seeding community branding");
  }
  const service = createManageService({ repo: createPostgresManageRepository(db), storage });
  const actor: Actor = { kind: "user", userId: owner.id, platformAdmin: false };
  return {
    creators: await brand(db, service, actor, creators),
    pro: await brand(db, service, actor, pro),
  };
}
