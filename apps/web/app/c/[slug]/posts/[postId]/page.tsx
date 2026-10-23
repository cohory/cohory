import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PostDetail } from "../../../../../components/feed/post-detail";
import { loadPostForViewer } from "./viewer";

const maxTitleLength = 60;

function shorten(text: string): string {
  return text.length > maxTitleLength ? `${text.slice(0, maxTitleLength - 1).trimEnd()}…` : text;
}

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]/posts/[postId]">): Promise<Metadata> {
  const { slug, postId } = await params;
  const { post, page } = await loadPostForViewer(slug, postId);
  const heading = post.title ?? `Post by ${post.author.name}`;
  return { title: `${shorten(heading)} · ${page.community.name}` };
}

export default async function PostDetailPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/posts/[postId]">) {
  const { slug, postId } = await params;
  const { edit } = await searchParams;
  const detail = await loadPostForViewer(slug, postId);
  const communitySlug = detail.page.community.slug;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/c/${communitySlug}`}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-sm font-medium text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to the feed
      </Link>
      <PostDetail
        slug={communitySlug}
        post={detail.post}
        comments={detail.comments}
        hasMoreComments={detail.hasMoreComments}
        canComment={detail.canComment}
        canLike={detail.canLike}
        canFollow={detail.canFollow}
        signedIn={detail.page.session !== null}
        startEditing={edit === "1"}
      />
    </div>
  );
}
