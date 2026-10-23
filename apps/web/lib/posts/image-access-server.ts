import { getCoursesService, getPostsService } from "@cohory/api/services";
import { ForbiddenError } from "@cohory/authz";
import { CoursesError } from "@cohory/courses";
import { PostsError } from "@cohory/posts";

import { currentSession } from "../session";
import type { ImageAccessDeps, Viewer } from "./image-access";

function actorOf(viewer: Viewer) {
  return viewer.kind === "user"
    ? { kind: "user" as const, userId: viewer.userId, platformAdmin: false }
    : { kind: "guest" as const };
}

async function canReadPosts(viewer: Viewer, communityId: string): Promise<boolean> {
  try {
    await getPostsService().listFeed(actorOf(viewer), communityId, { limit: 1 });
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof PostsError) return false;
    throw error;
  }
}

async function attachmentFor(
  viewer: Viewer,
  communityId: string,
  key: string,
): Promise<{ name: string } | null> {
  try {
    return await getCoursesService().getLessonAttachment(actorOf(viewer), communityId, key);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof CoursesError) return null;
    throw error;
  }
}

async function currentViewer(): Promise<Viewer> {
  const session = await currentSession();
  return session ? { kind: "user", userId: session.user.id } : { kind: "guest" };
}

export const imageAccessDeps: ImageAccessDeps = { canReadPosts, attachmentFor, currentViewer };
