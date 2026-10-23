import { getCommunityUploadGuard } from "@cohory/communities/fair-use";
import { parseAppUrl } from "@cohory/config/platform";
import { getDb } from "@cohory/db";
import { getStorage } from "@cohory/storage";

import { createPostgresCoursesRepository } from "./postgres-repository";
import {
  createAgentAuthoringOperations,
  type AgentAuthoringOperations,
} from "./service/agent-authoring";
import {
  createAgentDeliveryOperations,
  type AgentDeliveryOperations,
} from "./service/agent-delivery";
import { createAgentReadingOperations, type AgentReadingOperations } from "./service/agent-reading";
import {
  createRuntime,
  type AgentCourseAccessCheck,
  type CoursesServiceDeps,
} from "./service/context";
import { createCourseOperations, type CourseOperations } from "./service/courses";
import { createLearningOperations, type LearningOperations } from "./service/learning";
import { createLessonOperations, type LessonOperations } from "./service/lessons";
import { createSearchOperations, type SearchOperations } from "./service/search";

export type CoursesService = CourseOperations &
  LessonOperations &
  LearningOperations &
  SearchOperations &
  AgentAuthoringOperations &
  AgentReadingOperations &
  AgentDeliveryOperations;

export function createCoursesService(deps: CoursesServiceDeps): CoursesService {
  const runtime = createRuntime(deps);
  return {
    ...createCourseOperations(runtime),
    ...createLessonOperations(runtime),
    ...createLearningOperations(runtime),
    ...createSearchOperations(runtime),
    ...createAgentAuthoringOperations(runtime),
    ...createAgentReadingOperations(runtime),
    ...createAgentDeliveryOperations(runtime),
  };
}

/** Production adapters; the process composition root passes the agent access check. */
export function createDefaultCoursesService(wiring: {
  readonly agentAccess: AgentCourseAccessCheck;
}): CoursesService {
  return createCoursesService({
    repo: createPostgresCoursesRepository(getDb()),
    agentAccess: wiring.agentAccess,
    storage: getStorage(),
    appUrl: parseAppUrl(),
    downloadSecret: process.env.BETTER_AUTH_SECRET || undefined,
    uploadGuard: getCommunityUploadGuard(),
  });
}
