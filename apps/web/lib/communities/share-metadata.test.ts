import { describe, expect, it } from "vitest";

import { aboutShareMetadata, communityShareMetadata, inviteShareMetadata } from "./share-metadata";

const base = "https://cohory.example";

describe("communityShareMetadata", () => {
  it("uses the cover of a public community as the Open Graph and large Twitter card image", () => {
    const metadata = communityShareMetadata(
      {
        name: "Makers Guild",
        privacy: "public",
        coverUrl: "/api/uploads/communities/c/branding/cover.png",
      },
      base,
      "Cohory",
    );

    expect(metadata.metadataBase?.toString()).toBe("https://cohory.example/");
    expect(metadata.openGraph).toEqual({
      title: "Makers Guild",
      images: ["/api/uploads/communities/c/branding/cover.png"],
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      images: ["/api/uploads/communities/c/branding/cover.png"],
    });
  });

  it("keeps an absolute storage URL as it is", () => {
    const metadata = communityShareMetadata(
      { name: "Makers Guild", privacy: "public", coverUrl: "https://cdn.example.com/cover.png" },
      base,
      "Cohory",
    );

    expect(metadata.twitter).toMatchObject({ images: ["https://cdn.example.com/cover.png"] });
  });

  it("keeps the cover, the name, and the instance image out of a private community's previews", () => {
    const metadata = communityShareMetadata(
      { name: "Inner Circle", privacy: "private", coverUrl: "/api/uploads/cover.png" },
      base,
      "Cohory",
    );

    expect(metadata.openGraph).toEqual({
      type: "website",
      siteName: "Cohory",
      title: "Cohory",
      images: [],
    });
    expect(metadata.twitter).toEqual({ card: "summary", title: "Cohory", images: [] });
    expect(JSON.stringify(metadata)).not.toMatch(/cover\.png|Inner Circle/);
  });

  it("adds no image when a public community has no cover", () => {
    const metadata = communityShareMetadata(
      { name: "Makers Guild", privacy: "public", coverUrl: null },
      base,
      "Cohory",
    );

    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
  });
});

describe("aboutShareMetadata", () => {
  it("titles the About page with the community name and describes it with the short description", () => {
    const metadata = aboutShareMetadata(
      {
        name: "Makers Guild",
        description: "Learn to launch, price, and grow a paid community.",
        privacy: "public",
        coverUrl: null,
      },
      base,
      "Cohory",
    );

    expect(metadata.title).toEqual({ absolute: "About Makers Guild · Cohory" });
    expect(metadata.description).toBe("Learn to launch, price, and grow a paid community.");
    expect(metadata.openGraph).toEqual({
      title: "About Makers Guild",
      description: "Learn to launch, price, and grow a paid community.",
    });
    expect(metadata.twitter).toEqual({ card: "summary" });
  });

  it("puts no cover, name, or description of a private community in its About link preview", () => {
    const metadata = aboutShareMetadata(
      {
        name: "Inner Circle",
        description: "Weekly calls for our paying clients.",
        privacy: "private",
        coverUrl: "/api/uploads/cover.png",
      },
      base,
      "Cohory",
    );

    expect(metadata.title).toEqual({ absolute: "About Inner Circle · Cohory" });
    expect(metadata.description).toBeUndefined();
    expect(metadata.openGraph).toMatchObject({ title: "Cohory", images: [] });
    expect(metadata.twitter).toMatchObject({ card: "summary", title: "Cohory", images: [] });
    expect(JSON.stringify({ ...metadata, title: undefined })).not.toMatch(
      /cover\.png|Inner Circle|Weekly calls/,
    );
  });

  it("shares the cover, title, and short description of a public community's About page", () => {
    const metadata = aboutShareMetadata(
      {
        name: "Makers Guild",
        description: "Learn to launch a paid community.",
        privacy: "public",
        coverUrl: "/api/uploads/cover.png",
      },
      base,
      "Cohory",
    );

    expect(metadata.openGraph).toEqual({
      title: "About Makers Guild",
      description: "Learn to launch a paid community.",
      images: ["/api/uploads/cover.png"],
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      images: ["/api/uploads/cover.png"],
    });
  });

  it("shortens a long short description to one line for link previews", () => {
    const metadata = aboutShareMetadata(
      {
        name: "Long",
        description: `${"word ".repeat(60)}\nsecond line`,
        privacy: "public",
        coverUrl: null,
      },
      base,
      "Cohory",
    );

    const description = String(metadata.description);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith("…")).toBe(true);
    expect(description).not.toContain("\n");
  });
});

const invited = {
  name: "Makers Guild",
  privacy: "public",
  description: "Weekly build nights for hardware makers.",
  coverUrl: "https://acme.example.com/cover.png",
} as const;

describe("inviteShareMetadata", () => {
  it("previews the invite as joining the community on this server, with its cover", () => {
    const metadata = inviteShareMetadata(invited, "https://acme.example.com", "Acme Academy");

    expect(metadata.title).toEqual({ absolute: "Join Makers Guild on Acme Academy" });
    expect(metadata.description).toBe("Weekly build nights for hardware makers.");
    expect(metadata.openGraph).toMatchObject({
      title: "Join Makers Guild on Acme Academy",
      images: ["https://acme.example.com/cover.png"],
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("keeps invite pages out of search results", () => {
    const metadata = inviteShareMetadata(invited, "https://acme.example.com", "Acme Academy");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("falls back to the server's own image when the community has no cover", () => {
    const metadata = inviteShareMetadata(
      { ...invited, coverUrl: null, description: null },
      "https://acme.example.com",
      "Acme Academy",
    );
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata).not.toHaveProperty("description");
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });

  it("names only the server for a private community, with no cover or description", () => {
    const metadata = inviteShareMetadata(
      { ...invited, privacy: "private" },
      "https://acme.example.com",
      "Acme Academy",
    );

    expect(metadata.title).toEqual({ absolute: "Join with an invite · Acme Academy" });
    expect(metadata).not.toHaveProperty("description");
    expect(metadata.openGraph).toMatchObject({ title: "Acme Academy", images: [] });
    expect(metadata.twitter).toMatchObject({ title: "Acme Academy", images: [] });
    expect(JSON.stringify(metadata)).not.toContain("Makers Guild");
    expect(JSON.stringify(metadata)).not.toContain("cover.png");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
