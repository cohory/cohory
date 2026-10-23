"use client";

import { CheckCircle2Icon, ChevronDownIcon, CircleIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Badge } from "../primitives/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import type { LessonStatus } from "./types";

interface CourseOutlineLesson {
  id: string;
  slug: string;
  title: string;
  status: LessonStatus;
  completed: boolean;
  href: string;
}

interface CourseOutlineModule {
  id: string;
  title: string;
  lessons: CourseOutlineLesson[];
}

interface CourseOutlineProps {
  modules: CourseOutlineModule[];
  currentLessonId?: string | null;
  collapsible?: boolean;
  editable?: false;
  label?: string;
  className?: string;
}

const LESSON_LINK = "a[data-slot='course-outline-lesson']";

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(LESSON_LINK)) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(LESSON_LINK));
  const index = links.indexOf(target);
  if (index === -1) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? links.length - 1
        : event.key === "ArrowDown"
          ? Math.min(index + 1, links.length - 1)
          : Math.max(index - 1, 0);
  links[next]?.focus();
}

function LessonRow({ lesson, current }: { lesson: CourseOutlineLesson; current: boolean }) {
  return (
    <li>
      <Link
        href={lesson.href}
        data-slot="course-outline-lesson"
        data-current={current || undefined}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-text transition-colors duration-(--duration-fast) outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
          current && "bg-accent-muted font-medium hover:bg-accent-muted",
        )}
      >
        {lesson.completed ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <CircleIcon className="size-4 shrink-0 text-text-subtle" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {lesson.title}
          {lesson.completed ? <span className="sr-only">, completed</span> : null}
          {lesson.status === "draft" ? <span className="sr-only">,</span> : null}
        </span>
        {lesson.status === "draft" ? (
          <>
            {" "}
            <Badge variant="warning">Draft</Badge>
          </>
        ) : null}
      </Link>
    </li>
  );
}

function ModuleSection({
  module,
  currentLessonId,
  collapsible,
}: {
  module: CourseOutlineModule;
  currentLessonId?: string | null;
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(true);
  const done = module.lessons.filter((lesson) => lesson.completed).length;
  const summary = (
    <>
      <span aria-hidden="true" className="text-xs font-medium text-text-muted tabular-nums">
        {done} of {module.lessons.length}
      </span>
      <span className="sr-only">
        , {done} of {module.lessons.length} lessons completed
      </span>
    </>
  );
  const list =
    module.lessons.length > 0 ? (
      <ul className="flex flex-col gap-0.5">
        {module.lessons.map((lesson) => (
          <LessonRow key={lesson.id} lesson={lesson} current={lesson.id === currentLessonId} />
        ))}
      </ul>
    ) : (
      <p className="px-3 py-2 text-sm text-text-muted">No lessons yet.</p>
    );

  if (!collapsible) {
    return (
      <section data-slot="course-outline-module" className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-text">
          <span className="flex-1">{module.title}</span>
          {summary}
        </h3>
        {list}
      </section>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-slot="course-outline-module"
      className="flex flex-col gap-1"
    >
      <h3>
        <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-text outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex-1">{module.title}</span>
          {summary}
          <ChevronDownIcon
            className="size-4 text-text-muted transition-transform duration-(--duration-fast) group-data-[state=closed]:-rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent>{list}</CollapsibleContent>
    </Collapsible>
  );
}

function CourseOutline({
  modules,
  currentLessonId,
  collapsible = true,
  label = "Course outline",
  className,
}: CourseOutlineProps) {
  return (
    <nav
      aria-label={label}
      data-slot="course-outline"
      onKeyDown={moveFocus}
      className={cn("flex flex-col gap-3", className)}
    >
      {modules.map((module) => (
        <ModuleSection
          key={module.id}
          module={module}
          currentLessonId={currentLessonId}
          collapsible={collapsible}
        />
      ))}
    </nav>
  );
}

export {
  CourseOutline,
  type CourseOutlineLesson,
  type CourseOutlineModule,
  type CourseOutlineProps,
};
