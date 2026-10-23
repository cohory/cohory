import { agentLicenseLabels } from "@cohory/courses";
import type { Metadata } from "next";

import { AgentAccessPanel } from "../../../../../../components/classroom/agent-access-panel";
import { CourseView } from "../../../../../../components/classroom/course-view";
import { agentExportHref, lessonHref } from "../../../../../../lib/courses/hrefs";
import { loadAgentAuthoring, loadCourse } from "../../../../../../lib/courses/load";
import { readMemberPreview } from "../../../../../../lib/courses/preview";
import { loadCourseAgentPanel } from "../../../../../../lib/entitlements/load";
import { loadLevelOptions } from "../../../../../../lib/members/load";
import {
  coverUrl,
  resumeTarget,
  toEditorModules,
  toOutline,
  visibleModules,
} from "../../../../../../lib/courses/views";

export async function generateMetadata({
  params,
}: PageProps<"/c/[slug]/classroom/[courseSlug]">): Promise<Metadata> {
  const { slug, courseSlug } = await params;
  const { course } = await loadCourse(slug, courseSlug);
  return { title: course.title };
}

const dateLabel = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function CoursePage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/classroom/[courseSlug]">) {
  const [{ slug, courseSlug }, { edit }] = await Promise.all([params, searchParams]);
  const [data, preview] = await Promise.all([loadCourse(slug, courseSlug), readMemberPreview()]);
  const previewing = data.manager && preview;
  const manager = data.manager && !preview;
  const { page, course } = data;
  const [authoring, agentPanel, levels] = await Promise.all([
    loadAgentAuthoring({ ...data, manager }),
    previewing ? null : loadCourseAgentPanel(page, course.id),
    manager ? loadLevelOptions(page) : [],
  ]);
  const communitySlug = page.community.slug;
  const modules = visibleModules(course.modules, manager);
  const resume = resumeTarget(modules);

  return (
    <div className="flex flex-col gap-6">
      <CourseView
        slug={communitySlug}
        course={{
          slug: course.slug,
          title: course.title,
          description: course.description,
          coverKey: course.coverKey,
          coverUrl: coverUrl(course.coverKey),
          lessonCount: manager ? course.lessonCount : course.publishedLessonCount,
          status: course.status,
          requiredLevel: course.requiredLevel,
          locked: course.locked,
        }}
        outline={toOutline(communitySlug, course.slug, modules)}
        editorModules={manager ? toEditorModules(communitySlug, course.slug, modules) : []}
        memberCount={page.community.memberCount}
        progressPercent={
          page.role !== null && course.publishedLessonCount > 0 ? course.progressPercent : null
        }
        resume={
          resume
            ? {
                label: resume.label,
                href: lessonHref(communitySlug, course.slug, resume.lessonSlug),
              }
            : null
        }
        manager={manager}
        levels={levels}
        previewing={previewing}
        initialEditing={edit === "1"}
        agentMaterial={
          authoring
            ? {
                lessons: authoring.lessons.map((lesson) => ({
                  id: lesson.id,
                  title: lesson.title,
                  moduleTitle: lesson.moduleTitle,
                  href: `${lessonHref(communitySlug, course.slug, lesson.slug)}?edit=1`,
                  status: lesson.status,
                  hasLayer: lesson.hasLayer,
                  includedOnPublish: lesson.includedOnPublish,
                })),
                versions: authoring.versions.map((version) => ({
                  version: version.version,
                  changelog: version.changelog,
                  checksum: version.checksum,
                  publishedAt: dateLabel.format(version.publishedAt),
                  downloadHref: agentExportHref(communitySlug, course.slug, version.version),
                })),
                nextVersions: authoring.nextVersions,
                license: {
                  label: agentLicenseLabels[authoring.license.id],
                  text: authoring.license.text,
                },
              }
            : null
        }
        agentAccess={
          agentPanel ? (
            <AgentAccessPanel
              slug={communitySlug}
              courseSlug={course.slug}
              data={agentPanel}
              lessonTitles={Object.fromEntries(
                modules.flatMap((module) =>
                  module.lessons.map((lesson) => [lesson.id, lesson.title]),
                ),
              )}
            />
          ) : null
        }
      />
    </div>
  );
}
