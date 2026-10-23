import "#server-only";

import { getAgentsService } from "@cohory/agents";
import { getApprovalsService } from "@cohory/agents/approvals";
import { getAuth } from "@cohory/auth";
import { getCalendarService } from "@cohory/calendar";
import { getCommunitiesService, getManageService } from "@cohory/communities";
import { createDefaultCoursesService, type CoursesService } from "@cohory/courses";
import { getDb } from "@cohory/db";
import { createEntitlementsService, type EntitlementsService } from "@cohory/entitlements";
import { getGamificationService } from "@cohory/gamification";
import { getMembersService } from "@cohory/members";
import { getMigrationService } from "@cohory/migration";
import {
  getAgentAccessNotifier,
  getNotificationsService,
  getPreferencesService,
  publishPostEventsAfterCommit,
} from "@cohory/notifications";
import { getPaymentsService } from "@cohory/payments";
import { getPlatformBillingService } from "@cohory/payments/billing";
import { createDefaultPostsService, type PostsService } from "@cohory/posts";
import { getRateLimiter } from "@cohory/rate-limit";
import { getReviewsService } from "@cohory/reviews";
import { createDefaultSearchService, type SearchService } from "@cohory/search";
import { getWebhooksService } from "@cohory/webhooks";

import type { ApiDeps } from "./app";
import { betterAuthSessionResolver } from "./middleware/session";

/*
 * The composition root of the web process (the Next.js app and the /api/v1 app it mounts).
 * Services whose wiring crosses modules are built here once; the web app imports them from
 * `@cohory/api/services` instead of building a second instance.
 */

function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

export const getEntitlementsService: () => EntitlementsService = once(() =>
  createEntitlementsService({
    db: getDb(),
    agents: {
      find: (communityId, agentId) => getAgentsService().findAgent(communityId, agentId),
      list: (communityId, filter) => getAgentsService().agentSummaries(communityId, filter),
    },
    membershipAccess: (communityId, userId) =>
      getPaymentsService().getMembershipAccess(communityId, userId),
    notify: getAgentAccessNotifier(),
  }),
);

export const getCoursesService: () => CoursesService = once(() =>
  createDefaultCoursesService({ agentAccess: getEntitlementsService() }),
);

/** Relays post events to notifications right after commit; the outbox relay is the fallback. */
export const getPostsService: () => PostsService = once(() =>
  createDefaultPostsService({ onEvents: publishPostEventsAfterCommit }),
);

export const getSearchService: () => SearchService = once(() =>
  createDefaultSearchService({ posts: getPostsService(), courses: getCoursesService() }),
);

type DepFactories = { readonly [K in keyof ApiDeps]: () => ApiDeps[K] };

const defaultFactories: DepFactories = {
  resolveSession: once(() => betterAuthSessionResolver(getAuth())),
  communities: getCommunitiesService,
  posts: getPostsService,
  notifications: getNotificationsService,
  preferences: getPreferencesService,
  members: getMembersService,
  gamification: getGamificationService,
  courses: getCoursesService,
  calendar: getCalendarService,
  manage: getManageService,
  reviews: getReviewsService,
  search: getSearchService,
  migration: getMigrationService,
  payments: getPaymentsService,
  platformBilling: getPlatformBillingService,
  webhooks: getWebhooksService,
  agents: getAgentsService,
  approvals: getApprovalsService,
  entitlements: getEntitlementsService,
  rateLimiter: getRateLimiter,
};

/**
 * Every API dependency, built on first use. `overrides` replaces some of them, which is how tests
 * pass fakes for the services they exercise.
 */
export function apiDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  const deps = { ...overrides };
  for (const key of Object.keys(defaultFactories) as (keyof ApiDeps)[]) {
    if (deps[key] === undefined) {
      Object.defineProperty(deps, key, {
        enumerable: true,
        get: defaultFactories[key],
      });
    }
  }
  return deps as ApiDeps;
}
