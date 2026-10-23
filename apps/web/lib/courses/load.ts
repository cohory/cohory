import { getCoursesService } from "@cohory/api/services";
import { can, ForbiddenError } from "@cohory/authz";
import {
  CoursesError,
  type AgentAuthoring,
  type ContinueLearning,
  type CourseDetail,
  type CourseSummary,
  type LessonAgentLayerView,
  type LessonDetail,
} from "@cohory/courses";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireFullCommunityPage, type FullCommunityPage } from "../communities/load";

export function canManageCourses(page: FullCommunityPage): boolean {
  return can(page.actor, "update", "course", {
    role: page.role,
    communityPrivacy: page.community.privacy,
    entitled: page.entitled,
  });
}

function isHidden(error: unknown): boolean {
  return error instanceof CoursesError || error instanceof ForbiddenError;
}

export type ClassroomData =
  | { readonly status: "forbidden"; readonly page: FullCommunityPage }
  | {
      readonly status: "ok";
      readonly page: FullCommunityPage;
      readonly manager: boolean;
      readonly courses: CourseSummary[];
    };

export async function loadClassroom(slug: string): Promise<ClassroomData> {
  const page = await requireFullCommunityPage(slug);
  try {
    const courses = await getCoursesService().listCourses(page.actor, page.community.id);
    return { status: "ok", page, manager: canManageCourses(page), courses };
  } catch (error) {
    if (isHidden(error)) return { status: "forbidden", page };
    throw error;
  }
}

export interface CourseData {
  readonly page: FullCommunityPage;
  readonly manager: boolean;
  readonly course: CourseDetail;
}

export const loadCourse = cache(async (slug: string, courseSlug: string): Promise<CourseData> => {
  const page = await requireFullCommunityPage(slug);
  try {
    const course = await getCoursesService().getCourse(page.actor, page.community.id, courseSlug);
    return { page, manager: canManageCourses(page), course };
  } catch (error) {
    if (isHidden(error)) notFound();
    throw error;
  }
});

export interface LessonData extends CourseData {
  readonly lesson: LessonDetail;
}

export const loadLesson = cache(
  async (slug: string, courseSlug: string, lessonSlug: string): Promise<LessonData> => {
    const page = await requireFullCommunityPage(slug);
    const [data, lesson] = await Promise.all([
      loadCourse(slug, courseSlug),
      getCoursesService()
        .getLesson(page.actor, page.community.id, courseSlug, lessonSlug)
        .catch((error: unknown) => {
          if (isHidden(error)) notFound();
          throw error;
        }),
    ]);
    return { ...data, lesson };
  },
);

export const loadContinueLearning = cache(
  async (page: FullCommunityPage): Promise<ContinueLearning | null> => {
    if (page.role === null) return null;
    try {
      return await getCoursesService().getContinueLearning(page.actor, page.community.id);
    } catch (error) {
      if (isHidden(error)) return null;
      throw error;
    }
  },
);

export async function loadAgentAuthoring(data: CourseData): Promise<AgentAuthoring | null> {
  if (!data.manager) return null;
  return getCoursesService().getAgentAuthoring(
    data.page.actor,
    data.page.community.id,
    data.course.slug,
  );
}

export async function loadLessonAgentLayer(data: LessonData): Promise<LessonAgentLayerView | null> {
  if (!data.manager) return null;
  return getCoursesService().getLessonAgentLayer(
    data.page.actor,
    data.page.community.id,
    data.lesson.id,
  );
}
