"use client";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CourseHeader,
  CourseOutline,
  CoursePublishControl,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
  type CourseOutlineModule,
  type CourseSummary,
  type ItemAction,
  type LevelOption,
  type OutlineEditorModule,
  type PublishChoice,
} from "@cohory/ui";
import {
  ArrowLeftIcon,
  BookOpen,
  ChevronDownIcon,
  LockIcon,
  PencilIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  deleteCourseAction,
  publishCourseAction,
  unpublishCourseAction,
  updateCourseAction,
} from "../../lib/courses/actions";
import { classroomHref, courseHref } from "../../lib/courses/hrefs";
import { EmptyState } from "../empty-state";
import { ConfirmDialog } from "../feed/confirm-dialog";
import type { AgentMaterialSectionProps } from "./agent-material-section";
import { MemberPreviewBanner, MemberPreviewButton } from "./member-preview";

const OutlineEditorPanel = dynamic(() =>
  import("./outline-editor-panel").then((mod) => mod.OutlineEditorPanel),
);
const CourseForm = dynamic(() => import("./course-form").then((mod) => mod.CourseForm));
const AgentMaterialSection = dynamic(() =>
  import("./agent-material-section").then((mod) => mod.AgentMaterialSection),
);

export interface CourseViewProps {
  slug: string;
  course: CourseSummary & {
    slug: string;
    status: "draft" | "published" | "archived";
    coverKey: string | null;
  };
  outline: CourseOutlineModule[];
  editorModules: OutlineEditorModule[];
  memberCount: number;
  progressPercent: number | null;
  resume: { label: string; href: string } | null;
  manager: boolean;
  previewing: boolean;
  initialEditing: boolean;
  agentMaterial: Omit<AgentMaterialSectionProps, "slug" | "courseSlug"> | null;
  agentAccess: ReactNode;
  levels: readonly LevelOption[];
}

function publishedToast(announced: boolean | null): string {
  if (announced === null) return "Course published.";
  return announced
    ? "Course published and announced in the feed."
    : "Course published. The announcement could not be posted.";
}

function lessonCounts(modules: readonly OutlineEditorModule[]) {
  const lessons = modules.flatMap((module) => module.lessons);
  const published = lessons.filter((lesson) => lesson.status === "published").length;
  return { published, draft: lessons.length - published };
}

export function CourseView({
  slug,
  course,
  outline,
  editorModules,
  memberCount,
  progressPercent,
  resume,
  manager,
  previewing,
  initialEditing,
  agentMaterial,
  agentAccess,
  levels,
}: CourseViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(manager && initialEditing);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const actions: ItemAction[] = manager
    ? [
        {
          id: "settings",
          label: "Course settings",
          icon: <SettingsIcon aria-hidden="true" />,
          onSelect: () => setSettingsOpen(true),
        },
        {
          id: "delete",
          label: "Delete course",
          icon: <Trash2Icon aria-hidden="true" />,
          variant: "danger",
          onSelect: () => setDeleteOpen(true),
        },
      ]
    : [];

  async function publish(choice: PublishChoice): Promise<boolean> {
    const result = await publishCourseAction({ slug, courseSlug: course.slug, ...choice });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast(publishedToast(choice.announce ? result.data.announced : null));
    router.refresh();
    return true;
  }

  async function unpublish(): Promise<boolean> {
    const result = await unpublishCourseAction({ slug, courseSlug: course.slug });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast("Course moved to drafts.");
    router.refresh();
    return true;
  }

  const hasLessons = outline.some((module) => module.lessons.length > 0);
  const published = course.status === "published";
  const agentsOpenByDefault = agentMaterial?.lessons.some((lesson) => lesson.hasLayer) ?? false;

  return (
    <div className="flex flex-col gap-6">
      {previewing ? <MemberPreviewBanner slug={slug} /> : null}
      <Link
        href={classroomHref(slug)}
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-text-muted outline-none hover:text-text focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Classroom
      </Link>
      <div className={editing ? "hidden md:block" : undefined}>
        <CourseHeader
          course={course}
          progressPercent={progressPercent}
          actions={actions}
          primaryAction={resume ?? undefined}
        />
      </div>
      {editing ? (
        <div className="flex min-w-0 items-center md:hidden">
          <h1 className="min-w-0 flex-1 truncate font-heading text-xl text-text">{course.title}</h1>
        </div>
      ) : null}
      {manager ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) px-4 py-3">
          <CoursePublishControl
            status={published ? "published" : "draft"}
            courseTitle={course.title}
            lessonCounts={lessonCounts(editorModules)}
            memberCount={memberCount}
            onPublish={publish}
            onUnpublish={unpublish}
          />
          <div className="flex flex-wrap items-center gap-2">
            {editing ? null : <MemberPreviewButton slug={slug} />}
            <Button
              type="button"
              variant="secondary"
              aria-pressed={editing}
              onClick={() => setEditing((value) => !value)}
            >
              <PencilIcon className="size-4" aria-hidden="true" />
              {editing ? "Done editing" : "Edit outline"}
            </Button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <OutlineEditorPanel
          key={course.slug}
          slug={slug}
          courseSlug={course.slug}
          modules={editorModules}
        />
      ) : course.locked && course.requiredLevel ? (
        <EmptyState icon={LockIcon} title={`Unlocks at Level ${course.requiredLevel}`}>
          Members reach new levels by earning points in the community. The leaderboard shows how.
        </EmptyState>
      ) : hasLessons ? (
        <section aria-labelledby="outline-heading" className="flex flex-col gap-3">
          <h2 id="outline-heading" className="text-lg text-text">
            Lessons
          </h2>
          <CourseOutline
            modules={outline}
            className="rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-2"
          />
        </section>
      ) : (
        <EmptyState icon={BookOpen} title="No lessons yet">
          {manager
            ? "Choose Edit outline to add modules and lessons."
            : "Lessons in this course will show up here."}
        </EmptyState>
      )}
      {manager && (agentMaterial || agentAccess) ? (
        <Collapsible defaultOpen={agentsOpenByDefault} className="flex flex-col gap-4">
          <CollapsibleTrigger className="group inline-flex min-h-11 items-center gap-2 self-start rounded-sm text-lg text-text outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
            Agents
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-6">
            {agentMaterial ? (
              <AgentMaterialSection slug={slug} courseSlug={course.slug} {...agentMaterial} />
            ) : null}
            {agentAccess}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <>
          {agentMaterial ? (
            <AgentMaterialSection slug={slug} courseSlug={course.slug} {...agentMaterial} />
          ) : null}
          {agentAccess}
        </>
      )}
      {manager ? (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Course settings</DialogTitle>
              <DialogDescription>Change the title, description, or cover.</DialogDescription>
            </DialogHeader>
            <CourseForm
              slug={slug}
              initial={{
                title: course.title,
                description: course.description ?? "",
                coverKey: course.coverKey,
                coverUrl: course.coverUrl ?? null,
                requiredLevel: course.requiredLevel ?? null,
              }}
              levels={levels}
              submitLabel="Save"
              pendingLabel="Saving…"
              onCancel={() => setSettingsOpen(false)}
              onSubmit={async (value) => {
                const result = await updateCourseAction({
                  slug,
                  courseSlug: course.slug,
                  title: value.title,
                  description: value.description.trim() || null,
                  coverKey: value.coverKey,
                  ...(levels.length > 1 ? { requiredLevel: value.requiredLevel ?? null } : {}),
                });
                if (!result.ok) return result;
                setSettingsOpen(false);
                router.replace(courseHref(slug, result.data.courseSlug));
                router.refresh();
                return null;
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {manager ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Delete "${course.title}"?`}
          description="If members have progress in it, the course is archived instead so their progress is kept."
          confirmLabel="Delete course"
          onConfirm={async () => {
            const result = await deleteCourseAction({ slug, courseSlug: course.slug });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setDeleteOpen(false);
            toast(result.data.outcome === "archived" ? "Course archived." : "Course deleted.");
            router.push(classroomHref(slug));
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
