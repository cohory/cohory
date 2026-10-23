import { describe, expect, it } from "vitest";

import {
  createInviteSchema,
  deleteCommunitySchema,
  gamificationSchema,
  generalSettingsSchema,
  hexColorSchema,
  namesMatch,
  saveAppearanceSchema,
} from "./schemas";

const color = (digits: string) => `#${digits}`;

const nineNames = Array.from({ length: 9 }, (_, i) => `Level ${i + 1}`);

describe("hexColorSchema", () => {
  it.each([color("16A34A"), color("16a34a"), ` ${color("2563EB")} `])("accepts %j", (value) => {
    expect(hexColorSchema.safeParse(value).success).toBe(true);
  });

  it.each(["blue", color("FFF"), "16A34A", color("GGGGGG"), `${color("2563EB")}FF`])(
    "rejects %j",
    (value) => {
      const result = hexColorSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(`Enter a color like ${color("2563EB")}.`);
    },
  );
});

describe("saveAppearanceSchema", () => {
  const valid = {
    slug: "makers",
    accent: color("16A34A"),
    font: "nunito-sans",
    cardStyle: "minimal",
    theme: "dark",
  } as const;

  it("accepts a full appearance and a reset accent", () => {
    expect(saveAppearanceSchema.parse(valid)).toEqual(valid);
    expect(saveAppearanceSchema.parse({ ...valid, accent: null }).accent).toBeNull();
  });

  it("rejects fonts, card styles, and themes outside the curated options", () => {
    expect(saveAppearanceSchema.safeParse({ ...valid, font: "comic-sans" }).success).toBe(false);
    expect(saveAppearanceSchema.safeParse({ ...valid, cardStyle: "glass" }).success).toBe(false);
    expect(saveAppearanceSchema.safeParse({ ...valid, theme: "auto" }).success).toBe(false);
  });
});

describe("gamificationSchema", () => {
  it("leaves the learning point switches out when the form does not send them", () => {
    const base = { slug: "makers", enabled: true, levelNames: nineNames };
    const parsed = gamificationSchema.parse(base);
    expect(parsed).not.toHaveProperty("pointsForLessons");
    expect(parsed).not.toHaveProperty("pointsForEvents");
    expect(
      gamificationSchema.parse({ ...base, pointsForLessons: true, pointsForEvents: false }),
    ).toMatchObject({ pointsForLessons: true, pointsForEvents: false });
  });

  it("accepts nine trimmed names", () => {
    const parsed = gamificationSchema.parse({
      slug: "makers",
      enabled: true,
      levelNames: nineNames.map((name) => ` ${name} `),
    });
    expect(parsed.levelNames).toEqual(nineNames);
  });

  it("requires exactly nine names", () => {
    const result = gamificationSchema.safeParse({
      slug: "makers",
      enabled: true,
      levelNames: nineNames.slice(0, 8),
    });
    expect(result.error?.issues[0]?.message).toBe("Name all nine levels.");
  });

  it("rejects empty names and names longer than 30 characters", () => {
    const empty = gamificationSchema.safeParse({
      slug: "makers",
      enabled: true,
      levelNames: ["", ...nineNames.slice(1)],
    });
    expect(empty.error?.issues[0]?.message).toBe("Give every level a name.");
    const long = gamificationSchema.safeParse({
      slug: "makers",
      enabled: true,
      levelNames: ["x".repeat(31), ...nineNames.slice(1)],
    });
    expect(long.error?.issues[0]?.message).toBe("Keep level names to 30 characters or fewer.");
    expect(
      gamificationSchema.safeParse({
        slug: "makers",
        enabled: true,
        levelNames: ["x".repeat(30), ...nineNames.slice(1)],
      }).success,
    ).toBe(true);
  });
});

describe("generalSettingsSchema", () => {
  it("requires a name and a known privacy", () => {
    expect(
      generalSettingsSchema.safeParse({ slug: "m", name: " ", privacy: "public" }).error?.issues[0]
        ?.message,
    ).toBe("Enter a community name.");
    expect(
      generalSettingsSchema.safeParse({ slug: "m", name: "M", privacy: "secret" }).success,
    ).toBe(false);
  });
});

describe("createInviteSchema", () => {
  it("allows no expiry and no limit, and rejects zero uses", () => {
    expect(
      createInviteSchema.safeParse({ slug: "m", expiresInDays: null, maxUses: null }).success,
    ).toBe(true);
    expect(createInviteSchema.safeParse({ slug: "m", expiresInDays: 7, maxUses: 0 }).success).toBe(
      false,
    );
  });
});

describe("namesMatch", () => {
  it("compares the typed name exactly, ignoring outer spaces", () => {
    expect(namesMatch("Makers Club", " Makers Club ")).toBe(true);
    expect(namesMatch("Makers Club", "makers club")).toBe(false);
  });
});

describe("deleteCommunitySchema", () => {
  it("cancels linked imports and asks for no manual confirmation by default", () => {
    expect(deleteCommunitySchema.parse({ slug: "makers", confirmName: "Makers" })).toEqual({
      slug: "makers",
      confirmName: "Makers",
      includeLinked: true,
      confirmedManualCancellation: false,
    });
  });
});
