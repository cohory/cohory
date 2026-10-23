import { describe, expect, it, vi } from "vitest";

import { communityEmailBrand, communityImageUrl, emailLogoUrl } from "./community-brand";

vi.stubEnv("APP_URL", "https://community.example.com");

const storage = (base: string) => () => ({ publicUrl: (key: string) => `${base}/${key}` });

describe("communityEmailBrand", () => {
  it("resolves an uploads route logo against APP_URL and keeps the accent", () => {
    expect(
      communityEmailBrand(
        { logoKey: "communities/c1/branding/logo.png", accent: "#7C3AED" },
        storage("/api/uploads"),
      ),
    ).toEqual({
      logoUrl: "https://community.example.com/api/uploads/communities/c1/branding/logo.png",
      accent: "#7C3AED",
    });
  });

  it("keeps an absolute CDN logo", () => {
    expect(
      communityEmailBrand(
        { logoKey: "communities/c1/logo.png" },
        storage("https://cdn.example.net"),
      ).logoUrl,
    ).toBe("https://cdn.example.net/communities/c1/logo.png");
  });

  it("drops a logo that would not load over https", () => {
    expect(
      communityEmailBrand({ logoKey: "communities/c1/logo.png" }, storage("http://localhost:3000"))
        .logoUrl,
    ).toBeNull();
  });

  it("resolves a logo URL from a view the same way", () => {
    expect(emailLogoUrl("/api/uploads/communities/c1/logo.png")).toBe(
      "https://community.example.com/api/uploads/communities/c1/logo.png",
    );
    expect(emailLogoUrl(null)).toBeNull();
  });

  it("has no logo or accent without an appearance", () => {
    const publicUrl = vi.fn();
    expect(communityEmailBrand(undefined, () => ({ publicUrl }))).toEqual({
      logoUrl: null,
      accent: null,
    });
    expect(communityEmailBrand({ logoKey: "../etc/passwd" }, () => ({ publicUrl }))).toEqual({
      logoUrl: null,
      accent: null,
    });
    expect(publicUrl).not.toHaveBeenCalled();
  });
});

describe("communityImageUrl", () => {
  it("uses the logo first, then the cover, as an https URL", () => {
    const urls = storage("https://cdn.example.net");

    expect(
      communityImageUrl(
        { logoKey: "communities/c1/logo.png", coverKey: "communities/c1/cover.png" },
        urls,
      ),
    ).toBe("https://cdn.example.net/communities/c1/logo.png");
    expect(communityImageUrl({ coverKey: "communities/c1/cover.png" }, urls)).toBe(
      "https://cdn.example.net/communities/c1/cover.png",
    );
    expect(communityImageUrl({}, urls)).toBeNull();
  });
});
