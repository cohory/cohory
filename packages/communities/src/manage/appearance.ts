import { assertCan, type Actor } from "@cohory/authz";
import { communityIdSchema, newId } from "@cohory/db";
import type { CommunityAppearance } from "@cohory/db/schema";
import { assertStorageCapacity, assertUploadSize, resolveLimits } from "@cohory/fair-use";
import {
  avatarMaxBytes,
  communityKey,
  communityPrefix,
  parseStorageKey,
  prepareImage,
  storedImageKeys,
  storePreparedImage,
  validateImage,
  type ImageUpload,
} from "@cohory/storage";
import { logger } from "@cohory/infra/logger";

import { deriveAppearanceTokens } from "../appearance/tokens";
import { assertCommunityWritable } from "../archive";
import { parseDetailedDescription } from "../description";
import { CommunityNotFoundError } from "../errors";
import { fairUseTier } from "../fair-use";
import { storedImageSuffix } from "../gallery";
import { inManagedCommunity, parseInput, type Managed, type Runtime } from "./context";
import {
  updateAboutInputSchema,
  updateAppearanceInputSchema,
  type UpdateAboutInput,
  type UpdateAppearanceInput,
} from "./schemas";
import type { CommunityPatch } from "./repository";
import { toAppearanceView, type AppearanceView } from "./views";

export type BrandingKind = "logo" | "cover";

export const brandingMaxBytes: Readonly<Record<BrandingKind, number>> = {
  logo: avatarMaxBytes,
  cover: 10 * 1024 * 1024,
};

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const brandingKeyPattern = new RegExp(
  `^communities\\/${uuid}\\/branding\\/(logo|cover)-${uuid}${storedImageSuffix}$`,
);

export function isBrandingKey(key: string): boolean {
  return brandingKeyPattern.test(key);
}

export async function assertStorageRoom(
  runtime: Runtime,
  managed: Pick<Managed, "community" | "store">,
  uploadBytes: number,
  storedBytes: number = uploadBytes,
): Promise<void> {
  const limits = await resolveLimits(runtime.fairUse(), ["storageBytes", "uploadBytes"], () =>
    fairUseTier((since) => managed.store.hasPaidTransactionSince(since), runtime.now()),
  );
  assertUploadSize(limits, uploadBytes);
  if (limits.storageBytes !== null) {
    const used = await runtime.storage.usedBytes(communityPrefix(managed.community.id));
    assertStorageCapacity(limits, used, storedBytes);
  }
}

function normalizedAccent(accent: string | null): string | null {
  return accent === null ? null : accent.toUpperCase();
}

function emptyAsNull<T>(items: T[] | undefined): T[] | null | undefined {
  return items === undefined || items.length > 0 ? items : null;
}

function aboutPatch(input: UpdateAboutInput): CommunityPatch {
  const { whatYouGet, faq, detailedDescription, ...text } = parseInput(
    updateAboutInputSchema,
    input,
  );
  return {
    ...text,
    whatYouGet: emptyAsNull(whatYouGet),
    faq: emptyAsNull(faq),
    detailedDescription:
      detailedDescription === undefined || detailedDescription === null
        ? detailedDescription
        : parseDetailedDescription(detailedDescription),
  };
}

function definedKeys(patch: CommunityPatch): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

function appearanceKey(kind: BrandingKind): "logoKey" | "coverKey" {
  return kind === "logo" ? "logoKey" : "coverKey";
}

export function appearanceOperations(runtime: Runtime) {
  async function save(
    actor: Actor,
    communityId: string,
    change: (current: CommunityAppearance) => CommunityAppearance,
    audit: Record<string, unknown>,
    extra: Pick<CommunityPatch, "detailedDescription"> = {},
  ): Promise<{ view: AppearanceView; replaced: CommunityAppearance }> {
    return inManagedCommunity(runtime, actor, communityId, async (managed) => {
      assertCan(actor, "update", "appearance", managed.context);
      assertCommunityWritable(managed.community);
      const replaced = managed.community.appearance;
      const appearance = change(replaced);
      const updated = await managed.store.updateCommunity({
        appearance,
        appearanceTokens: deriveAppearanceTokens(appearance),
        ...extra,
      });
      await managed.store.appendAudit({
        actorId: managed.user.userId,
        action: "appearance.updated",
        target: managed.community.id,
        metadata: audit,
      });
      return { view: toAppearanceView(updated, runtime.brandingUrl), replaced };
    });
  }

  async function removeReplaced(
    previous: string | null | undefined,
    next: string | null | undefined,
  ) {
    if (!previous || previous === next || !isBrandingKey(previous)) {
      return;
    }
    try {
      for (const key of storedImageKeys(parseStorageKey(previous))) {
        await runtime.storage.delete(key);
      }
    } catch (error: unknown) {
      logger.warn(
        { name: error instanceof Error ? error.name : "unknown" },
        "unused branding file was not deleted",
      );
    }
  }

  return {
    async getAppearance(communityId: string): Promise<AppearanceView> {
      const parsedId = communityIdSchema.safeParse(communityId);
      const community = parsedId.success ? await runtime.repo.findCommunity(parsedId.data) : null;
      if (!community) {
        throw new CommunityNotFoundError();
      }
      return toAppearanceView(community, runtime.brandingUrl);
    },

    async updateAppearance(
      actor: Actor,
      communityId: string,
      input: UpdateAppearanceInput,
    ): Promise<AppearanceView> {
      const { logo, cover, accent, detailedDescription, ...rest } = parseInput(
        updateAppearanceInputSchema,
        input,
      );
      const description =
        detailedDescription === undefined
          ? {}
          : {
              detailedDescription:
                detailedDescription === null ? null : parseDetailedDescription(detailedDescription),
            };
      const { view, replaced } = await save(
        actor,
        communityId,
        (current) => ({
          ...current,
          ...rest,
          ...(accent !== undefined ? { accent: normalizedAccent(accent) } : {}),
          ...(logo === null ? { logoKey: null } : {}),
          ...(cover === null ? { coverKey: null } : {}),
        }),
        { fields: Object.keys(input) },
        description,
      );
      if (logo === null) {
        await removeReplaced(replaced.logoKey, null);
      }
      if (cover === null) {
        await removeReplaced(replaced.coverKey, null);
      }
      return view;
    },

    async updateAbout(
      actor: Actor,
      communityId: string,
      input: UpdateAboutInput,
    ): Promise<AppearanceView> {
      const patch = aboutPatch(input);
      return inManagedCommunity(runtime, actor, communityId, async (managed) => {
        assertCan(actor, "update", "appearance", managed.context);
        assertCommunityWritable(managed.community);
        const updated = await managed.store.updateCommunity(patch);
        await managed.store.appendAudit({
          actorId: managed.user.userId,
          action: "about.updated",
          target: managed.community.id,
          metadata: { fields: definedKeys(patch) },
        });
        return toAppearanceView(updated, runtime.brandingUrl);
      });
    },

    async uploadBranding(
      actor: Actor,
      communityId: string,
      kind: BrandingKind,
      upload: ImageUpload,
    ): Promise<AppearanceView> {
      const image = validateImage(upload, brandingMaxBytes[kind]);
      const parsedId = communityIdSchema.safeParse(communityId);
      if (!parsedId.success) {
        throw new CommunityNotFoundError();
      }
      await inManagedCommunity(
        runtime,
        actor,
        communityId,
        async ({ community, context, store }) => {
          assertCan(actor, "update", "appearance", context);
          assertCommunityWritable(community);
          await assertStorageRoom(runtime, { community, store }, upload.bytes.byteLength);
        },
      );
      const input = {
        key: communityKey(parsedId.data, "branding", `${kind}-${newId()}.${image.extension}`),
        body: upload.bytes,
        contentType: image.contentType,
      };
      const prepared = await prepareImage(input, kind === "cover" ? runtime.processImage : null);
      if (prepared.bytes > upload.bytes.byteLength) {
        await inManagedCommunity(runtime, actor, communityId, async ({ community, store }) => {
          await assertStorageRoom(
            runtime,
            { community, store },
            upload.bytes.byteLength,
            prepared.bytes,
          );
        });
      }
      const key = await storePreparedImage(runtime.storage, prepared);
      const field = appearanceKey(kind);
      try {
        const { view, replaced } = await save(
          actor,
          communityId,
          (current) => ({ ...current, [field]: key }),
          { fields: [field] },
        );
        await removeReplaced(replaced[field], key);
        return view;
      } catch (error: unknown) {
        await removeReplaced(key, null);
        throw error;
      }
    },
  };
}
