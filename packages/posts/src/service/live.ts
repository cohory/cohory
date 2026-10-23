import type { PostRecord } from "../repository";

export function isLivePost(post: PostRecord | null): post is PostRecord {
  return post !== null && !post.deletedAt && !post.scheduledAt;
}
