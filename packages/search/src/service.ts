import { everyScope, ForbiddenError, type Actor, type ScopeCheck } from "@cohory/authz";
import { type CoursesService, type LessonSearchHit } from "@cohory/courses";
import { maxSearchLength, minSearchLength, searchTerms } from "@cohory/db";
import { getMembersService, type MemberSearchHit, type MembersService } from "@cohory/members";
import { type PostSearchHit, type PostsService } from "@cohory/posts";
import { getRateLimiter } from "@cohory/rate-limit";
import { z } from "zod";

export const searchGroupLimit = 10;

export const searchInputSchema = z.strictObject({
  query: z.string().trim().min(minSearchLength).max(maxSearchLength),
});

export type SearchInput = z.input<typeof searchInputSchema>;

export interface SearchResults {
  readonly query: string;
  readonly posts: readonly PostSearchHit[];
  readonly members: readonly MemberSearchHit[];
  readonly lessons: readonly LessonSearchHit[];
}

export class SearchValidationError extends Error {
  readonly code = "validation_failed";

  constructor() {
    super("search needs 2 to 100 characters with at least one word");
    this.name = "SearchValidationError";
  }
}

export interface SearchDeps {
  readonly posts: Pick<PostsService, "searchPosts">;
  readonly courses: Pick<CoursesService, "searchLessons">;
  readonly members: Pick<MembersService, "findMembers">;
  readonly rateLimit?: (key: string) => void;
  readonly groupLimit?: number;
}

export interface SearchService {
  search(
    actor: Actor,
    communityId: string,
    input: SearchInput,
    rateKey: string,
    allows?: ScopeCheck,
  ): Promise<SearchResults>;
}

async function unlessForbidden<T>(run: Promise<readonly T[]>): Promise<readonly T[]> {
  try {
    return await run;
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return [];
    }
    throw error;
  }
}

export function createSearchService(deps: SearchDeps): SearchService {
  const limit = deps.groupLimit ?? searchGroupLimit;
  return {
    async search(actor, communityId, input, rateKey, allows = everyScope) {
      const parsed = searchInputSchema.safeParse(input);
      if (!parsed.success || searchTerms(parsed.data.query).length === 0) {
        throw new SearchValidationError();
      }
      const { query } = parsed.data;
      deps.rateLimit?.(rateKey);
      const posts = await deps.posts.searchPosts(actor, communityId, query, limit, {
        comments: allows("comments:read"),
      });
      const [members, lessons] = await Promise.all([
        allows("members:read")
          ? unlessForbidden(deps.members.findMembers(actor, communityId, query, limit))
          : [],
        allows("courses:read")
          ? unlessForbidden(deps.courses.searchLessons(actor, communityId, query, limit))
          : [],
      ]);
      return { query, posts, members, lessons };
    },
  };
}

/** Production adapters for members and rate limits; the composition root passes posts and courses. */
export function createDefaultSearchService(
  wiring: Pick<SearchDeps, "posts" | "courses">,
): SearchService {
  return createSearchService({
    ...wiring,
    members: getMembersService(),
    rateLimit: (key) => getRateLimiter().consume("search", key),
  });
}
