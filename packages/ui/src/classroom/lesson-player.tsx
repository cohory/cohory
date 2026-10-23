"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "../primitives/button";
import { Link } from "../lib/link";
import { cn } from "../lib/utils";
import { LessonAttachments } from "./lesson-attachments";
import { LessonVideo } from "./lesson-video";
import type { LessonAttachment, LessonVideoProvider } from "./types";

interface LessonPlayerLesson {
  title: string;
  videoUrl?: string | null;
  videoProvider?: LessonVideoProvider | null;
  bodyHtml: string;
  attachments: LessonAttachment[];
}

interface LessonPlayerProgress {
  position: number;
  total: number;
  percent: number | null;
}

interface LessonPlayerFinish {
  courseTitle: string;
  nextCourse?: { title: string; href: string } | null;
  classroomHref: string;
  calendarHref?: string | null;
  nextLiveCall?: { title: string; when: string; href: string } | null;
  shareHref?: string | null;
}

interface LessonPlayerProps {
  lesson: LessonPlayerLesson;
  completed: boolean;
  onToggleComplete(): void | Promise<void>;
  previousHref?: string | null;
  nextHref?: string | null;
  onNavigate?(href: string): void;
  sidebar?: ReactNode;
  progress?: LessonPlayerProgress;
  finish?: LessonPlayerFinish;
  locale?: string;
  className?: string;
}

const wideQuery = "(min-width: 768px)";

function subscribeToWidth(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeToWidth,
    () => typeof window.matchMedia === "function" && window.matchMedia(wideQuery).matches,
    () => false,
  );
}

function progressText({ position, total, percent }: LessonPlayerProgress): string {
  const place = `Lesson ${position} of ${total}`;
  return percent === null ? place : `${place}, ${Math.round(percent)}% complete`;
}

const lessonProseClassName = [
  "text-base leading-7 text-text",
  "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:font-heading [&_h1]:text-2xl",
  "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:font-heading [&_h2]:text-xl",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold",
  "[&_p]:my-4 [&_strong]:font-semibold [&_em]:italic",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent-hover",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-4 [&_blockquote]:text-text-muted",
  "[&_code]:rounded-sm [&_code]:bg-surface-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-hover [&_pre]:p-4 [&_pre]:text-sm",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-8 [&_hr]:border-border [&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-md",
  "[&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
].join(" ");

function LessonFinishPanel({ finish }: { finish: LessonPlayerFinish }) {
  const headingId = useId();
  const next = finish.nextCourse;
  return (
    <section
      aria-labelledby={headingId}
      data-slot="lesson-finish"
      className="flex flex-col gap-3 rounded-(--card-radius) border border-border bg-accent-muted p-4 md:p-6"
    >
      <h2 id={headingId} className="font-heading text-xl text-text">
        You finished {finish.courseTitle}
      </h2>
      <p className="text-sm text-text-muted">
        Every lesson in this course is complete. Pick what to do next.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={next ? next.href : finish.classroomHref}>
            {next ? `Start ${next.title}` : "Back to Classroom"}
          </Link>
        </Button>
        {finish.shareHref ? (
          <Button asChild variant="secondary">
            <Link href={finish.shareHref}>Share your progress</Link>
          </Button>
        ) : null}
        {finish.nextLiveCall ? (
          <Button asChild variant="ghost" className="h-auto min-h-10 whitespace-normal text-left">
            <Link href={finish.nextLiveCall.href}>
              {`Next live call: ${finish.nextLiveCall.title}, ${finish.nextLiveCall.when}`}
            </Link>
          </Button>
        ) : finish.calendarHref ? (
          <Button asChild variant="ghost">
            <Link href={finish.calendarHref}>See upcoming live calls</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']",
    ) !== null
  );
}

function LessonPlayer({
  lesson,
  completed,
  onToggleComplete,
  previousHref,
  nextHref,
  onNavigate,
  sidebar,
  progress,
  finish,
  locale,
  className,
}: LessonPlayerProps) {
  const sidebarId = useId();
  const wide = useWideScreen();
  const [sidebarChoice, setSidebarChoice] = useState<boolean | null>(null);
  const sidebarOpen = sidebarChoice ?? wide;
  const [pending, setPending] = useState(false);
  const previousRef = useRef<HTMLAnchorElement>(null);
  const nextRef = useRef<HTMLAnchorElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ toggle: () => {}, navigate: (_direction: "previous" | "next") => {} });

  async function toggleComplete() {
    if (pending) return;
    const result = onToggleComplete();
    if (!(result instanceof Promise)) return;
    setPending(true);
    try {
      await result;
    } finally {
      setPending(false);
    }
  }

  function navigate(direction: "previous" | "next") {
    const href = direction === "previous" ? previousHref : nextHref;
    if (!href) return;
    if (onNavigate) {
      onNavigate(href);
      return;
    }
    (direction === "previous" ? previousRef : nextRef).current?.click();
  }

  useEffect(() => {
    latest.current = {
      toggle: () => void toggleComplete(),
      navigate,
    };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        latest.current.navigate("previous");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        latest.current.navigate("next");
      } else if ((event.key === "m" || event.key === "M") && !event.shiftKey) {
        event.preventDefault();
        latest.current.toggle();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [lesson.title]);

  const hasSidebar = sidebar !== undefined && sidebar !== null;
  const sidebarVisibility =
    sidebarChoice === null ? "hidden md:block" : sidebarChoice ? "block" : "hidden";

  return (
    <div
      data-slot="lesson-player"
      data-sidebar-open={hasSidebar && sidebarOpen ? "" : undefined}
      className={cn("flex flex-col gap-6 lg:flex-row lg:items-start", className)}
    >
      {hasSidebar && sidebarChoice !== false ? (
        <aside
          id={sidebarId}
          aria-label="Lessons"
          data-slot="lesson-player-sidebar"
          className={cn(
            "rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-2 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain",
            sidebarVisibility,
          )}
        >
          {sidebar}
        </aside>
      ) : null}
      <article className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="font-heading text-2xl text-text outline-none"
            >
              {lesson.title}
            </h1>
            {progress ? (
              <p data-slot="lesson-progress" className="text-sm text-text-muted tabular-nums">
                {progressText(progress)}
              </p>
            ) : null}
          </div>
          {hasSidebar ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={sidebarOpen}
              aria-controls={sidebarOpen ? sidebarId : undefined}
              onClick={() => setSidebarChoice(!sidebarOpen)}
              className="self-start md:order-first md:mt-0.5"
            >
              {sidebarChoice === null ? (
                <>
                  <PanelLeftOpenIcon className="size-4 md:hidden" aria-hidden="true" />
                  <PanelLeftCloseIcon className="hidden size-4 md:block" aria-hidden="true" />
                  <span className="md:hidden">Show lessons</span>
                  <span className="hidden md:inline">Hide lessons</span>
                </>
              ) : sidebarOpen ? (
                <>
                  <PanelLeftCloseIcon className="size-4" aria-hidden="true" />
                  Hide lessons
                </>
              ) : (
                <>
                  <PanelLeftOpenIcon className="size-4" aria-hidden="true" />
                  Show lessons
                </>
              )}
            </Button>
          ) : null}
        </div>
        {lesson.videoUrl ? (
          <LessonVideo url={lesson.videoUrl} provider={lesson.videoProvider} title={lesson.title} />
        ) : null}
        {lesson.bodyHtml.trim() ? (
          <div
            data-slot="lesson-body"
            className={lessonProseClassName}
            dangerouslySetInnerHTML={{ __html: lesson.bodyHtml }}
          />
        ) : null}
        <LessonAttachments attachments={lesson.attachments} locale={locale} />
        <nav
          aria-label="Lesson navigation"
          data-slot="lesson-player-bar"
          className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-(--z-raised) flex flex-wrap items-center gap-2 rounded-(--card-radius) border border-border bg-surface px-2 py-2 shadow-sm sm:px-4 md:bottom-0"
        >
          {previousHref ? (
            <Button asChild variant="ghost">
              <Link ref={previousRef} href={previousHref} rel="prev" aria-keyshortcuts="ArrowLeft">
                <ArrowLeftIcon className="size-4" aria-hidden="true" />
                Previous
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled>
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Previous
            </Button>
          )}
          <div className="flex flex-1 justify-center">
            <Button
              type="button"
              variant={completed ? "secondary" : "primary"}
              aria-pressed={completed}
              aria-keyshortcuts="M"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() => void toggleComplete()}
            >
              {completed ? (
                <>
                  <CheckIcon className="size-4 text-success" aria-hidden="true" />
                  Completed
                </>
              ) : (
                "Mark complete"
              )}
            </Button>
          </div>
          {nextHref ? (
            <Button asChild variant={completed ? "primary" : "ghost"}>
              <Link ref={nextRef} href={nextHref} rel="next" aria-keyshortcuts="ArrowRight">
                Next
                <ArrowRightIcon className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled>
              Next
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Button>
          )}
        </nav>
        {finish && completed && !nextHref ? <LessonFinishPanel finish={finish} /> : null}
      </article>
    </div>
  );
}

export {
  LessonPlayer,
  lessonProseClassName,
  type LessonPlayerFinish,
  type LessonPlayerLesson,
  type LessonPlayerProgress,
  type LessonPlayerProps,
};
