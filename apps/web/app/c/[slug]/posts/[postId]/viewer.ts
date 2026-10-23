import { signInPath } from "@cohory/auth";
import { redirect } from "next/navigation";

import { loadCommunityPage } from "../../../../../lib/communities/load";
import { loadPostDetail } from "../../../../../lib/posts/load";

// notFound() throws an error carrying this digest, and Next exports no guard for it.
const notFoundDigest = "NEXT_HTTP_ERROR_FALLBACK;404";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "digest" in error && error.digest === notFoundDigest;
}

export async function loadPostForViewer(slug: string, postId: string) {
  const page = await loadCommunityPage(slug);
  if (page.session) {
    return loadPostDetail(slug, postId);
  }
  const signIn = signInPath(`/c/${page.community.slug}/posts/${encodeURIComponent(postId)}`);
  if (page.access !== "full") {
    redirect(signIn);
  }
  try {
    return await loadPostDetail(slug, postId);
  } catch (error) {
    if (isNotFound(error)) redirect(signIn);
    throw error;
  }
}
