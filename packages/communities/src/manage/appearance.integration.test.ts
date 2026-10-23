import { ForbiddenError } from "@cohory/authz";
import { communities } from "@cohory/db/schema";
import { LimitReachedError, parseFairUseEnv } from "@cohory/fair-use";
import { StorageError } from "@cohory/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultAccentTokens } from "../appearance/accent";
import {
  CommunityArchivedError,
  CommunityNotFoundError,
  CommunityValidationError,
} from "../errors";
import {
  auditActions,
  cleanedImage,
  fakeImageProcessor,
  insertCast,
  openManageHarness,
  type ManageHarness,
} from "../test/manage-fixtures";
import { isBrandingKey } from "./appearance";

let h: ManageHarness;
let sized: ManageHarness;
let limitedSized: ManageHarness;
let archiving: ManageHarness;
let archiveDuringProcessing: string | null = null;

beforeAll(async () => {
  h = await openManageHarness();
  sized = await openManageHarness({ processImage: fakeImageProcessor() });
  limitedSized = await openManageHarness({
    fairUse: parseFairUseEnv({ FAIR_USE_STORAGE_BYTES: "1000" }),
    processImage: fakeImageProcessor((width) => width / 2),
  });
  archiving = await openManageHarness({
    processImage: fakeImageProcessor(undefined, async () => {
      if (archiveDuringProcessing) {
        await archiving.admin
          .update(communities)
          .set({ archivedAt: new Date() })
          .where(eq(communities.id, archiveDuringProcessing));
      }
    }),
  });
});

afterAll(async () => {
  await h.close();
  await sized.close();
  await limitedSized.close();
  await archiving.close();
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("appearance", () => {
  it("returns the default appearance for a new community to anyone", async () => {
    const cast = await insertCast(h.admin);

    const view = await h.service.getAppearance(cast.communityId);

    expect(view).toMatchObject({
      accent: null,
      logoUrl: null,
      coverUrl: null,
      font: "inter",
      cardStyle: "minimal",
      theme: "system",
      notices: [],
    });
    expect(view.tokens.light).toEqual(defaultAccentTokens.light);
    expect(view.cssVariables.dark["--color-accent"]).toBe("#60A5FA");
  });

  it("stores the appearance with derived tokens", async () => {
    const cast = await insertCast(h.admin);

    const view = await h.service.updateAppearance(cast.admin, cast.communityId, {
      accent: "#0f766e",
      font: "source-serif",
      cardStyle: "soft",
      theme: "dark",
    });

    expect(view.accent).toBe("#0F766E");
    expect(view.cssVariables.light["--color-accent"]).toBe("#0F766E");
    const [row] = await h.admin
      .select({ appearance: communities.appearance, tokens: communities.appearanceTokens })
      .from(communities)
      .where(eq(communities.id, cast.communityId));
    expect(row?.appearance).toMatchObject({ accent: "#0F766E", font: "source-serif" });
    expect(row?.tokens?.light.accent).toBe("#0F766E");
    expect(row?.tokens?.cardStyle).toBe("soft");
  });

  it("rejects an accent that is not a six digit hex color and warns for red", async () => {
    const cast = await insertCast(h.admin);

    await expect(
      h.service.updateAppearance(cast.owner, cast.communityId, { accent: "teal" }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    await expect(
      h.service.updateAppearance(cast.owner, cast.communityId, { accent: "#GGGGGG" }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    const untouched = await h.service.getAppearance(cast.communityId);
    expect(untouched.accent).toBeNull();
    expect(untouched.tokens.light).toEqual(defaultAccentTokens.light);

    const red = await h.service.updateAppearance(cast.owner, cast.communityId, {
      accent: "#E11D48",
    });
    expect(red.notices.map((n) => n.code)).toEqual(["red_hue"]);
  });

  it("flags a fallback when the color cannot be made readable", async () => {
    const cast = await insertCast(h.admin);

    const view = await h.service.updateAppearance(cast.owner, cast.communityId, {
      accent: "#050505",
    });

    expect(view.notices.map((n) => n.code)).toEqual(["fallback"]);
    expect(view.tokens.fallbackUsed).toBe(true);
  });

  it("stores width variants of a cover, not of a logo, and deletes them when replaced", async () => {
    const cast = await insertCast(sized.admin);
    const image = { bytes: png, declaredType: "image/png" };

    const logo = await sized.service.uploadBranding(cast.owner, cast.communityId, "logo", image);
    const first = await sized.service.uploadBranding(cast.owner, cast.communityId, "cover", image);
    const prefix = `communities/${cast.communityId}/branding/`;
    const firstStored = [...sized.storage.objects.keys()].filter((k) => k.includes("/cover-"));
    await sized.service.uploadBranding(cast.owner, cast.communityId, "cover", image);

    expect(logo.logoUrl).toMatch(/\/logo-[^/.]+\.png$/);
    expect(first.coverUrl).toMatch(/\/cover-[^/]+\.sized\.png$/);
    expect(firstStored).toHaveLength(5);
    expect(firstStored.every((k) => k.startsWith(prefix) && isBrandingKey(k))).toBe(true);
    expect(sized.storage.deleted).toEqual(expect.arrayContaining(firstStored));
    const original = firstStored.find((k) => k.endsWith(".sized.png")) ?? "";
    expect(sized.storage.objects.has(original)).toBe(false);
    const current = [...sized.storage.objects.entries()].find(([k]) => k.endsWith(".sized.png"));
    expect(current?.[1].body).toEqual(cleanedImage);
  });

  it("counts the resized copies of a cover against the storage limit", async () => {
    const cast = await insertCast(limitedSized.admin);

    const error = await limitedSized.service
      .uploadBranding(cast.owner, cast.communityId, "cover", {
        bytes: png,
        declaredType: "image/png",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LimitReachedError);
    expect(error).toMatchObject({ resource: "storage", limit: 1000 });
    expect([...limitedSized.storage.objects.keys()].some((k) => k.includes(cast.communityId))).toBe(
      false,
    );
  });

  it("deletes a stored cover and its variants when saving the appearance fails", async () => {
    const cast = await insertCast(archiving.admin);
    archiveDuringProcessing = cast.communityId;

    await expect(
      archiving.service.uploadBranding(cast.owner, cast.communityId, "cover", {
        bytes: png,
        declaredType: "image/png",
      }),
    ).rejects.toBeInstanceOf(CommunityArchivedError);
    archiveDuringProcessing = null;

    expect([...archiving.storage.objects.keys()].some((k) => k.includes(cast.communityId))).toBe(
      false,
    );
    expect(archiving.storage.deleted.filter((k) => k.includes(cast.communityId))).toHaveLength(5);
  });

  it("uploads a logo and cover under the branding prefix and replaces the old file", async () => {
    const cast = await insertCast(h.admin);

    const first = await h.service.uploadBranding(cast.owner, cast.communityId, "logo", {
      bytes: png,
      declaredType: "image/png",
    });
    const second = await h.service.uploadBranding(cast.owner, cast.communityId, "logo", {
      bytes: png,
      declaredType: "image/png",
    });
    const cover = await h.service.uploadBranding(cast.admin, cast.communityId, "cover", {
      bytes: png,
      declaredType: "image/png",
    });

    const firstKey = first.logoUrl?.replace("/api/uploads/", "") ?? "";
    const secondKey = second.logoUrl?.replace("/api/uploads/", "") ?? "";
    expect(isBrandingKey(firstKey)).toBe(true);
    expect(firstKey.startsWith(`communities/${cast.communityId}/branding/logo-`)).toBe(true);
    expect(h.storage.deleted).toContain(firstKey);
    expect(h.storage.objects.has(secondKey)).toBe(true);
    expect(cover.coverUrl).toMatch(new RegExp(`communities/${cast.communityId}/branding/cover-`));

    const cleared = await h.service.updateAppearance(cast.owner, cast.communityId, { logo: null });
    expect(cleared.logoUrl).toBeNull();
    expect(cleared.coverUrl).toBe(cover.coverUrl);
  });

  it("rejects a file that is not the image it claims to be", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.uploadBranding(cast.owner, cast.communityId, "cover", {
        bytes: new Uint8Array([1, 2, 3]),
        declaredType: "image/png",
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it.each(["moderator", "member"] as const)("refuses a %s", async (role) => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.updateAppearance(cast[role], cast.communityId, { theme: "dark" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      h.service.uploadBranding(cast[role], cast.communityId, "logo", {
        bytes: png,
        declaredType: "image/png",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(["moderator", "member", "outsider"] as const)(
    "refuses appearance changes and uploads from a %s",
    async (role) => {
      const cast = await insertCast(h.admin, "public");
      const storedBefore = h.storage.objects.size;
      await expect(
        h.service.updateAppearance(cast[role], cast.communityId, { cardStyle: "soft" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        h.service.uploadBranding(cast[role], cast.communityId, "logo", {
          bytes: png,
          declaredType: "image/png",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(h.storage.objects.size).toBe(storedBefore);
    },
  );

  it("does not let one community's owner restyle another community", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await expect(
      h.service.updateAppearance(cast.owner, other.communityId, { theme: "dark" }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    expect((await h.service.getAppearance(other.communityId)).theme).toBe("system");
  });

  it("answers not found for an unknown community", async () => {
    await expect(
      h.service.getAppearance("0192f0a0-0000-7000-8000-000000000000"),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
  });
});

describe("about page content", () => {
  it("starts empty with no host", async () => {
    const cast = await insertCast(h.admin);

    const view = await h.service.getAppearance(cast.communityId);

    expect(view.about).toEqual({ whatYouGet: [], host: null, faq: [] });
  });

  it("saves the short description, what you get, host, and FAQ in one call", async () => {
    const cast = await insertCast(h.admin);

    const view = await h.service.updateAbout(cast.admin, cast.communityId, {
      description: "  Learn to launch a paid community.  ",
      whatYouGet: [" Weekly live calls ", "A launch playbook"],
      hostBio: "I ran three communities.",
      hostCredential: "",
      faq: [{ q: "Can I cancel?", a: "Yes, any time from your account." }],
    });

    expect(view.about).toEqual({
      whatYouGet: ["Weekly live calls", "A launch playbook"],
      host: { bio: "I ran three communities.", credential: null },
      faq: [{ q: "Can I cancel?", a: "Yes, any time from your account." }],
    });
    const [row] = await h.admin
      .select({ description: communities.description })
      .from(communities)
      .where(eq(communities.id, cast.communityId));
    expect(row?.description).toBe("Learn to launch a paid community.");
    expect(await auditActions(h.admin, cast.communityId)).toContain("about.updated");
  });

  it("clears the lists and the host when they are emptied", async () => {
    const cast = await insertCast(h.admin);
    await h.service.updateAbout(cast.owner, cast.communityId, {
      whatYouGet: ["Weekly live calls"],
      hostBio: "Bio",
      faq: [{ q: "Q", a: "A" }],
    });

    const view = await h.service.updateAbout(cast.owner, cast.communityId, {
      whatYouGet: [],
      hostBio: null,
      hostCredential: null,
      faq: [],
    });

    expect(view.about).toEqual({ whatYouGet: [], host: null, faq: [] });
  });

  it("rejects more than six what you get lines and lines over 80 characters", async () => {
    const cast = await insertCast(h.admin);
    await expect(
      h.service.updateAbout(cast.owner, cast.communityId, {
        whatYouGet: ["1", "2", "3", "4", "5", "6", "7"],
      }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
    await expect(
      h.service.updateAbout(cast.owner, cast.communityId, { whatYouGet: ["x".repeat(81)] }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it("rejects more than eight FAQ entries", async () => {
    const cast = await insertCast(h.admin);
    const faq = Array.from({ length: 9 }, (_, index) => ({ q: `Q${index}`, a: "A" }));
    await expect(
      h.service.updateAbout(cast.owner, cast.communityId, { faq }),
    ).rejects.toBeInstanceOf(CommunityValidationError);
  });

  it.each(["moderator", "member", "outsider"] as const)(
    "refuses about page changes from a %s",
    async (role) => {
      const cast = await insertCast(h.admin, "public");
      await expect(
        h.service.updateAbout(cast[role], cast.communityId, { whatYouGet: ["Nope"] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await h.service.getAppearance(cast.communityId)).about.whatYouGet).toEqual([]);
    },
  );

  it("does not let one community's owner edit another community's about page", async () => {
    const cast = await insertCast(h.admin);
    const other = await insertCast(h.admin);
    await expect(
      h.service.updateAbout(cast.owner, other.communityId, { hostBio: "Not mine" }),
    ).rejects.toBeInstanceOf(CommunityNotFoundError);
    expect((await h.service.getAppearance(other.communityId)).about.host).toBeNull();
  });
});
