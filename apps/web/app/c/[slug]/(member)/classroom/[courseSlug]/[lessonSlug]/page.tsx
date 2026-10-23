import { withoutLeadingTitle } from "@cohory/courses/markdown";
import type { Metadata } from "next";

import { LessonView } from "../../../../../../../components/classroom/lesson-view";
import { calendarHref } from "../../../../../../../lib/calendar/hrefs";
import { loadUpcomingForViewer } from "../../../../../../../lib/calendar/load";
import { viewerTimeZone } from "../../../../../../../lib/calendar/viewer-time-zone";
import { classroomHref, courseHref, lessonHref } from "../../../../../../../lib/courses/hrefs";
import { emptyAgentLayer } from "@cohory/ui";

import { layerToForm } from "../../../../../../../lib/courses/agent-form";
import {
  loadClassroom,
  loadLesson,
  loadLessonAgentLayer,
  type LessonData,
} from "../../../../../../../lib/courses/load";
import { readMemberPreview } from "../../../../../../../lib/courses/preview";
import {
  lessonNeighbors,
  nextCourseAfter,
  nextLiveCall,
  toLessonAttachments,
  toOutline,
  visibleModules,
} from "../../../../../../../lib/courses/views";

type Props = PageProps<"/c/[slug]/classroom/[courseSlug]/[lessonSlug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, courseSlug, lessonSlug } = await params;
  const { lesson, course } = await loadLesson(slug, courseSlug, lessonSlug);
  return { title: `${lesson.title} · ${course.title}` };
}

async function loadNextCourse(data: LessonData, skip: boolean) {
  if (skip) return null;
  const classroom = await loadClassroom(data.page.community.slug);
  if (classroom.status !== "ok") return null;
  return nextCourseAfter(classroom.courses, data.course.slug);
}

async function loadNextLiveCall(data: LessonData, skip: boolean) {
  if (skip) return null;
  const [upcoming, zone] = await Promise.all([loadUpcomingForViewer(data.page), viewerTimeZone()]);
  return nextLiveCall(upcoming, data.page.community.slug, zone.timeZone);
}

export default async function LessonPage({ params, searchParams }: Props) {
  const [{ slug, courseSlug, lessonSlug }, { edit }] = await Promise.all([params, searchParams]);
  const [data, preview] = await Promise.all([
    loadLesson(slug, courseSlug, lessonSlug),
    readMemberPreview(),
  ]);
  const previewing = data.manager && preview;
  const manager = data.manager && !preview;
  const { page, course, lesson } = data;
  const communitySlug = page.community.slug;
  const modules = visibleModules(course.modules, manager);
  const neighbors = previewing
    ? lessonNeighbors(modules, lesson.id)
    : { previous: lesson.previousLesson, next: lesson.nextLesson };
  const skipFinish = neighbors.next !== null || (manager && edit === "1");
  const [agentLayer, nextCourse, liveCall] = await Promise.all([
    loadLessonAgentLayer({ ...data, manager }),
    loadNextCourse(data, skipFinish),
    loadNextLiveCall(data, skipFinish),
  ]);
  const link = (target: { slug: string } | null) =>
    target ? lessonHref(communitySlug, course.slug, target.slug) : null;

  return (
    <LessonView
      key={lesson.id}
      slug={communitySlug}
      course={{
        id: course.id,
        slug: course.slug,
        title: course.title,
        href: courseHref(communitySlug, course.slug),
      }}
      lesson={{
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        status: lesson.status,
        bodyHtml: withoutLeadingTitle(lesson.bodyHtml, lesson.title),
        bodyMarkdown: manager ? (lesson.bodyMarkdown ?? "") : undefined,
        videoUrl: lesson.videoUrl,
        attachments: toLessonAttachments(lesson.attachments),
      }}
      completed={lesson.completedAt !== null}
      previousHref={link(neighbors.previous)}
      nextHref={link(neighbors.next)}
      outline={toOutline(communitySlug, course.slug, modules)}
      manager={manager}
      previewing={previewing}
      draftHidden={previewing && lesson.status === "draft"}
      tracksProgress={page.role !== null}
      initialEditing={edit === "1"}
      agentLayer={
        agentLayer
          ? {
              initial: agentLayer.layer ? layerToForm(agentLayer.layer) : emptyAgentLayer,
              saved: agentLayer.layer !== null,
            }
          : null
      }
      finish={
        neighbors.next
          ? null
          : {
              courseTitle: course.title,
              nextCourse: nextCourse
                ? { title: nextCourse.title, href: courseHref(communitySlug, nextCourse.slug) }
                : null,
              classroomHref: classroomHref(communitySlug),
              calendarHref: calendarHref(communitySlug),
              nextLiveCall: liveCall,
              shareHref: page.role !== null ? `/c/${encodeURIComponent(communitySlug)}` : null,
            }
      }
    />
  );
}
