import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPostForViewer } from "./viewer";

interface PageStub {
  readonly session: { readonly user: { readonly id: string } } | null;
  readonly access: "full" | "limited";
  readonly community: { readonly slug: string };
}

const loaders = vi.hoisted(() => ({
  page: vi.fn<(slug: string) => Promise<PageStub>>(),
  post: vi.fn<(slug: string, postId: string) => Promise<{ readonly id: string }>>(),
}));

vi.mock("../../../../../lib/communities/load", () => ({ loadCommunityPage: loaders.page }));
vi.mock("../../../../../lib/posts/load", () => ({ loadPostDetail: loaders.post }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

const postId = "0199e7a0-0000-7000-8000-000000000001";
const signIn = `redirect:/sign-in?next=${encodeURIComponent(`/c/makers/posts/${postId}`)}`;
const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
  digest: "NEXT_HTTP_ERROR_FALLBACK;404",
});

function page(signedIn: boolean, access: PageStub["access"]): PageStub {
  return {
    session: signedIn ? { user: { id: "u1" } } : null,
    access,
    community: { slug: "makers" },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadPostForViewer", () => {
  it("sends a signed out visitor of a private community to sign in and back to the post", async () => {
    loaders.page.mockResolvedValue(page(false, "limited"));

    await expect(loadPostForViewer("makers", postId)).rejects.toThrow(signIn);
    expect(loaders.post).not.toHaveBeenCalled();
  });

  it("sends a signed out visitor to sign in when the post is for members only", async () => {
    loaders.page.mockResolvedValue(page(false, "full"));
    loaders.post.mockRejectedValue(notFound);

    await expect(loadPostForViewer("makers", postId)).rejects.toThrow(signIn);
  });

  it("shows a signed in person the not available page when they cannot see the post", async () => {
    loaders.page.mockResolvedValue(page(true, "limited"));
    loaders.post.mockRejectedValue(notFound);

    await expect(loadPostForViewer("makers", postId)).rejects.toBe(notFound);
  });

  it("shows a public post to a signed out visitor", async () => {
    loaders.page.mockResolvedValue(page(false, "full"));
    loaders.post.mockResolvedValue({ id: postId });

    await expect(loadPostForViewer("makers", postId)).resolves.toEqual({ id: postId });
  });
});
