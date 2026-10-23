"use client";

import { useId, useState, type ReactNode } from "react";

import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../primitives/dialog";
import { Switch } from "../primitives/switch";
import { cn } from "../lib/utils";

interface PublishToggleProps {
  status: "draft" | "published";
  onPublish(): void | Promise<void>;
  onUnpublish(): void | Promise<void>;
  disabled?: boolean;
  label?: string;
  className?: string;
}

function PublishToggle({
  status,
  onPublish,
  onUnpublish,
  disabled = false,
  label = "Published",
  className,
}: PublishToggleProps) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const published = status === "published";

  async function change(checked: boolean) {
    const result = checked ? onPublish() : onUnpublish();
    if (!(result instanceof Promise)) return;
    setPending(true);
    try {
      await result;
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      data-slot="publish-toggle"
      className={cn("inline-flex items-center gap-3 text-sm", className)}
    >
      <span aria-hidden="true" className={published ? "text-text-muted" : "font-medium text-text"}>
        Draft
      </span>
      <Switch
        id={id}
        checked={published}
        aria-label={label}
        aria-busy={pending || undefined}
        disabled={disabled || pending}
        onCheckedChange={(checked) => void change(checked)}
      />
      <span aria-hidden="true" className={published ? "font-medium text-text" : "text-text-muted"}>
        Published
      </span>
    </div>
  );
}

interface PublishChoice {
  publishDraftLessons: boolean;
  announce: boolean;
}

interface CoursePublishControlProps {
  status: "draft" | "published";
  courseTitle: string;
  lessonCounts: { published: number; draft: number };
  memberCount: number;
  onPublish(choice: PublishChoice): Promise<boolean>;
  onUnpublish(): Promise<boolean>;
  className?: string;
}

function lessons(count: number): string {
  return count === 1 ? "1 lesson" : `${count} lessons`;
}

function members(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

function CoursePublishControl({
  status,
  courseTitle,
  lessonCounts,
  memberCount,
  onPublish,
  onUnpublish,
  className,
}: CoursePublishControlProps) {
  const [open, setOpen] = useState(false);
  const published = status === "published";
  const total = lessonCounts.published + lessonCounts.draft;

  return (
    <div
      data-slot="course-publish-control"
      className={cn("flex flex-wrap items-center gap-3 text-sm", className)}
    >
      <Badge variant={published ? "success" : "warning"}>{published ? "Published" : "Draft"}</Badge>
      <span className="text-text-muted tabular-nums">
        {lessonCounts.published} of {lessons(total)} published
      </span>
      <Button
        type="button"
        variant={published ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
      >
        {published ? "Move to drafts" : "Publish course"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          published ? (
            <UnpublishDialogContent
              courseTitle={courseTitle}
              memberCount={memberCount}
              onConfirm={onUnpublish}
              onClose={() => setOpen(false)}
            />
          ) : (
            <PublishDialogContent
              courseTitle={courseTitle}
              lessonCounts={lessonCounts}
              onConfirm={onPublish}
              onClose={() => setOpen(false)}
            />
          )
        ) : null}
      </Dialog>
    </div>
  );
}

function usePending(): [boolean, (run: () => Promise<boolean>, onDone: () => void) => void] {
  const [pending, setPending] = useState(false);
  function start(run: () => Promise<boolean>, onDone: () => void) {
    setPending(true);
    void run()
      .then((done) => {
        if (done) onDone();
      })
      .finally(() => setPending(false));
  }
  return [pending, start];
}

function ConfirmFooter({
  pending,
  disabled,
  label,
  variant,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  disabled?: boolean;
  label: string;
  variant: "primary" | "danger";
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
      <Button
        type="button"
        variant={variant}
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        onClick={onConfirm}
      >
        {label}
      </Button>
    </DialogFooter>
  );
}

function Option({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-text">
      <input
        type="checkbox"
        className="size-4 accent-accent"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

function publishSummary(total: number, visible: number, hiddenDrafts: number): string {
  if (total === 0) return "Add a lesson before you publish the course.";
  if (visible === 0) {
    return "No lesson is published yet. Publish the draft lessons too, or publish a lesson first.";
  }
  const drafts =
    hiddenDrafts === 0
      ? ""
      : hiddenDrafts === 1
        ? " 1 lesson is still a draft."
        : ` ${hiddenDrafts} lessons are still drafts.`;
  return `${lessons(visible)} will be visible.${drafts}`;
}

function PublishDialogContent({
  courseTitle,
  lessonCounts,
  onConfirm,
  onClose,
}: {
  courseTitle: string;
  lessonCounts: CoursePublishControlProps["lessonCounts"];
  onConfirm: CoursePublishControlProps["onPublish"];
  onClose(): void;
}) {
  const [publishDraftLessons, setPublishDraftLessons] = useState(
    lessonCounts.published === 0 && lessonCounts.draft > 0,
  );
  const [announce, setAnnounce] = useState(false);
  const [pending, start] = usePending();
  const visible = lessonCounts.published + (publishDraftLessons ? lessonCounts.draft : 0);
  const hiddenDrafts = publishDraftLessons ? 0 : lessonCounts.draft;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{`Publish "${courseTitle}"?`}</DialogTitle>
        <DialogDescription>
          {publishSummary(lessonCounts.published + lessonCounts.draft, visible, hiddenDrafts)}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col">
        {lessonCounts.draft > 0 ? (
          <Option checked={publishDraftLessons} onChange={setPublishDraftLessons}>
            Publish draft lessons too
          </Option>
        ) : null}
        <Option checked={announce} onChange={setAnnounce}>
          Post an announcement in the feed
        </Option>
      </div>
      <ConfirmFooter
        pending={pending}
        disabled={visible === 0}
        label="Publish"
        variant="primary"
        onCancel={onClose}
        onConfirm={() => start(() => onConfirm({ publishDraftLessons, announce }), onClose)}
      />
    </DialogContent>
  );
}

function UnpublishDialogContent({
  courseTitle,
  memberCount,
  onConfirm,
  onClose,
}: {
  courseTitle: string;
  memberCount: number;
  onConfirm: CoursePublishControlProps["onUnpublish"];
  onClose(): void;
}) {
  const [pending, start] = usePending();

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{`Move "${courseTitle}" to drafts?`}</DialogTitle>
        <DialogDescription>
          {members(memberCount)} will no longer see this course. Their progress is kept.
        </DialogDescription>
      </DialogHeader>
      <ConfirmFooter
        pending={pending}
        label="Move to drafts"
        variant="danger"
        onCancel={onClose}
        onConfirm={() => start(onConfirm, onClose)}
      />
    </DialogContent>
  );
}

export {
  CoursePublishControl,
  PublishToggle,
  type CoursePublishControlProps,
  type PublishChoice,
  type PublishToggleProps,
};
