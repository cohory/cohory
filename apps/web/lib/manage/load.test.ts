import { afterEach, describe, expect, it, vi } from "vitest";

import { loadManageShell, requireManagePage } from "./load";

interface PageStub {
  readonly access: "full" | "limited";
  readonly actor: { readonly kind: "guest" } | { readonly kind: "user"; readonly userId: string };
  readonly role?: "owner" | "moderator" | "member" | null;
  readonly community: { readonly id: string; readonly slug: string };
}

const loader = vi.hoisted(() => ({ page: vi.fn<(slug: string) => Promise<PageStub>>() }));

vi.mock("../communities/load", () => ({ loadCommunityPage: loader.page }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not_found");
  }),
}));

const community = { id: "0199e7a0-0000-7000-8000-000000000001", slug: "makers" };
const guest: PageStub = { access: "limited", actor: { kind: "guest" }, community };
const owner: PageStub = {
  access: "full",
  actor: { kind: "user", userId: "u1" },
  role: "owner",
  community,
};

afterEach(() => {
  loader.page.mockReset();
});

describe("requireManagePage", () => {
  it("sends a signed out owner from the requests link of a private community to sign in and back", async () => {
    loader.page.mockResolvedValue(guest);
    const next = encodeURIComponent("/c/makers/manage/people?tab=requests");
    await expect(requireManagePage("makers", "people", { tab: "requests" })).rejects.toThrow(
      `redirect:/sign-in?next=${next}`,
    );
  });

  it.each([
    { tab: "//evil.example" },
    { tab: "https://evil.example" },
    { next: "/\\evil.example", tab: "\\\\evil.example" },
  ])("keeps the sign in next on this site for a crafted query %o", async (query) => {
    loader.page.mockResolvedValue(guest);
    const error = await requireManagePage("makers", "people", query).catch((e: unknown) => e);
    const target = error instanceof Error ? error.message.replace(/^redirect:/, "") : "";
    const next = new URL(target, "http://cohory.test").searchParams.get("next") ?? "";

    expect(next.startsWith("/c/makers/manage/people?")).toBe(true);
    expect(new URL(next, "http://cohory.test").origin).toBe("http://cohory.test");
  });

  it.each(["//evil.example", "https:", "\\evil.example"])(
    "never sends a slug that is not a plain path segment off site (%s)",
    async (slug) => {
      loader.page.mockResolvedValue({ ...guest, community: { ...community, slug } });
      const error = await requireManagePage(slug, "inbox").catch((e: unknown) => e);
      const target = error instanceof Error ? error.message.replace(/^redirect:/, "") : "";
      const next = new URL(target, "http://cohory.test").searchParams.get("next");

      expect(
        next === null || new URL(next, "http://cohory.test").origin === "http://cohory.test",
      ).toBe(true);
    },
  );

  it("sends a signed in person without full access to the community page", async () => {
    loader.page.mockResolvedValue({ ...guest, actor: { kind: "user", userId: "u2" } });
    await expect(requireManagePage("makers", "inbox")).rejects.toThrow("redirect:/c/makers");
  });

  it("hides Manage from a member", async () => {
    loader.page.mockResolvedValue({ ...owner, role: "member" });
    await expect(requireManagePage("makers", "inbox")).rejects.toThrow("not_found");
  });

  it("lands a moderator on Inbox from Overview", async () => {
    loader.page.mockResolvedValue({ ...owner, role: "moderator" });
    await expect(requireManagePage("makers", "overview")).rejects.toThrow(
      "redirect:/c/makers/manage/inbox",
    );
  });

  it("opens the section for the owner", async () => {
    loader.page.mockResolvedValue(owner);
    await expect(requireManagePage("makers", "settings")).resolves.toMatchObject({
      role: "owner",
      slug: "makers",
      communityId: community.id,
    });
  });
});

describe("loadManageShell", () => {
  it("leaves the sign in redirect to the page, which knows the full link", async () => {
    loader.page.mockResolvedValue(guest);
    await expect(loadManageShell("makers")).resolves.toBeNull();
  });

  it("returns the sections for a moderator", async () => {
    loader.page.mockResolvedValue({ ...owner, role: "moderator" });
    await expect(loadManageShell("makers")).resolves.toMatchObject({
      sections: ["inbox", "people"],
    });
  });
});
