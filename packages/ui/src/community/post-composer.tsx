"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Input } from "../primitives/input";
import { draftSavedTime, useDraftAutosave } from "../lib/use-draft-autosave";
import { useUnsavedChanges } from "../lib/use-unsaved-changes";
import { formatCount } from "../lib/format-number";
import { cn } from "../lib/utils";
import { composeDocument, extractEmbeds } from "./compose-document";
import { ComposerAttachments } from "./composer-attachments";
import {
  CategoryField,
  CollapsedComposer,
  ComposerActionBar,
  ComposerBody,
  imageDropHandlers,
} from "./composer-fields";
import { DiscardConfirm, DraftRestoreOffer, MemberEmailField } from "./composer-prompts";
import { ComposerSchedule } from "./composer-schedule";
import { MAX_POST_IMAGES } from "./content";
import { useMentionAutocomplete, useUnresolvedMentions } from "./mention-suggestions";
import {
  parsePostComposerDraft,
  postComposerLimits,
  type PostComposerCategory,
  type PostComposerDraft,
  type PostComposerInitial,
  type PostComposerMemberEmail,
  type PostComposerProps,
  type PostComposerSubmission,
} from "./post-composer-types";
import { resolveMentions } from "./resolve-mentions";
import { localInputValue, scheduleInstant } from "./schedule";
import { useImageAttachments } from "./use-image-attachments";

const DEFAULT_MAX_LENGTH = 10_000;
const networkFailure = "We couldn't reach the server. Check your connection and try again.";
const shell =
  "border-y border-border bg-surface p-4 text-text md:rounded-(--card-radius) md:border-x md:shadow-(--card-shadow)";

function PostComposer({
  onSubmit,
  onUploadImage,
  onResolveMention,
  onSearchMentions,
  onCancel,
  viewer,
  placeholder = "Write something",
  showTitle = true,
  maxLength = DEFAULT_MAX_LENGTH,
  maxTitleLength = postComposerLimits.title,
  draftKey,
  maxImages = MAX_POST_IMAGES,
  canPost = true,
  disabledReason,
  error,
  defaultExpanded = false,
  categories = [],
  defaultCategoryId = null,
  allowSchedule = false,
  memberEmail = null,
  initial,
  label = "New post",
  submitLabel,
  className,
}: PostComposerProps) {
  const editing = initial !== undefined;
  const [expanded, setExpanded] = useState(defaultExpanded || editing);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? defaultCategoryId ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [scheduling, setScheduling] = useState(Boolean(initial?.scheduledAt));
  const [scheduleLocal, setScheduleLocal] = useState(() =>
    initial?.scheduledAt ? localInputValue(new Date(initial.scheduledAt)) : "",
  );
  const [emailMembers, setEmailMembers] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const attachments = useImageAttachments({ maxImages, onUploadImage, initial: initial?.images });
  const focusTarget = useRef<"body" | "trigger" | "keep" | null>(
    defaultExpanded || editing ? "body" : null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const counterId = useId();
  const errorId = useId();
  const unresolvedId = useId();
  const mentions = useMentionAutocomplete({
    text,
    setText,
    textareaRef: bodyRef,
    onSearch: onSearchMentions,
  });
  const unresolved = useUnresolvedMentions(text, onResolveMention);
  const draftValue = useMemo(
    () => ({ title, text, categoryId, scheduleLocal }),
    [title, text, categoryId, scheduleLocal],
  );
  const typed = editing
    ? title !== (initial.title ?? "") || text !== initial.text
    : title.trim() !== "" || text.trim() !== "";
  const draft = useDraftAutosave(editing ? null : (draftKey ?? null), draftValue, {
    dirty: typed,
    parse: parsePostComposerDraft,
  });
  useUnsavedChanges(typed && !submitting);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "body") bodyRef.current?.focus();
    if (target === "trigger") triggerRef.current?.focus();
    if (target === "keep") keepRef.current?.focus();
  }, [expanded, confirmingDiscard]);

  if (!canPost) {
    return (
      <p
        data-slot="post-composer"
        data-state="disabled"
        className={cn(
          "border-y border-border bg-surface p-4 text-sm text-text-muted md:rounded-(--card-radius) md:border-x md:shadow-(--card-shadow)",
          className,
        )}
      >
        {disabledReason ?? "You can't post in this community."}
      </p>
    );
  }

  const length = text.length;
  const overLimit = length > maxLength;
  const embeds = extractEmbeds(text).embeds;
  const hasContent = typed || attachments.attachments.length > 0;
  const hasBody = text.trim() !== "" || attachments.images.length > 0;
  const scheduledAt = scheduling ? scheduleInstant(scheduleLocal) : null;
  const canSubmit =
    hasBody &&
    !overLimit &&
    !attachments.uploading &&
    !attachments.failed &&
    !submitting &&
    (!scheduling || scheduledAt !== null);

  function expand() {
    focusTarget.current = "body";
    setExpanded(true);
  }

  function reset() {
    if (editing) return;
    draft.clear();
    setTitle("");
    setText("");
    setCategoryId(defaultCategoryId ?? "");
    setScheduling(false);
    setScheduleLocal("");
    setEmailMembers(false);
    attachments.clear();
    setConfirmingDiscard(false);
    focusTarget.current = "trigger";
    setExpanded(false);
  }

  function restoreDraft(saved: PostComposerDraft) {
    draft.clear();
    setTitle(saved.title);
    setText(saved.text);
    setCategoryId(saved.categoryId);
    setScheduleLocal(saved.scheduleLocal);
    setScheduling(saved.scheduleLocal !== "");
    focusTarget.current = "body";
    setExpanded(true);
  }

  function cancel() {
    reset();
    onCancel?.();
  }

  function requestCancel() {
    if (submitting) return;
    if (editing || !hasContent) {
      cancel();
      return;
    }
    focusTarget.current = "keep";
    setConfirmingDiscard(true);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitFailed(false);
    try {
      const resolveMention = await resolveMentions(text, onResolveMention);
      const document = composeDocument(text, attachments.images, [], { resolveMention });
      const knownCategory = categories.some((category) => category.id === categoryId);
      await onSubmit({
        title: showTitle && title.trim() ? title.trim() : null,
        document,
        categoryId: knownCategory ? categoryId : null,
        scheduledAt,
        emailMembers: memberEmail !== null && emailMembers && !scheduling,
      });
      reset();
    } catch {
      setSubmitFailed(true);
      focusTarget.current = "body";
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (confirmingDiscard) {
        focusTarget.current = "body";
        setConfirmingDiscard(false);
        return;
      }
      requestCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  const drop = imageDropHandlers(attachments.add, submitting);
  const shownError = error ?? (submitFailed ? networkFailure : null);

  const saved = draft.restore;
  const restoreOffer = saved ? (
    <DraftRestoreOffer
      savedAt={draftSavedTime(saved.savedAt)}
      onRestore={() => restoreDraft(saved.value)}
      onDiscard={draft.clear}
    />
  ) : null;

  if (!expanded) {
    return (
      <CollapsedComposer
        shell={shell}
        className={className}
        viewer={viewer}
        placeholder={placeholder}
        triggerRef={triggerRef}
        onExpand={expand}
        restoreOffer={restoreOffer}
      />
    );
  }

  return (
    <div
      data-slot="post-composer"
      data-state={submitting ? "submitting" : "expanded"}
      role="group"
      aria-label={label}
      onKeyDown={handleKeyDown}
      onDragOver={drop.onDragOver}
      onDrop={drop.onDrop}
      className={cn(shell, "flex flex-col gap-3", className)}
    >
      {showTitle ? (
        <Input
          aria-label="Title (optional)"
          placeholder="Title (optional)"
          value={title}
          maxLength={maxTitleLength}
          readOnly={submitting}
          onChange={(event) => setTitle(event.target.value)}
          className="text-lg font-semibold"
        />
      ) : null}
      {restoreOffer}
      <CategoryField
        categories={categories}
        value={categoryId}
        disabled={submitting}
        onChange={setCategoryId}
      />
      <ComposerBody
        bodyRef={bodyRef}
        placeholder={placeholder}
        text={text}
        onTextChange={setText}
        readOnly={submitting}
        invalid={overLimit}
        describedBy={cn(
          counterId,
          shownError ? errorId : undefined,
          unresolved.length > 0 ? unresolvedId : undefined,
        )}
        mentions={mentions}
        unresolved={unresolved}
        unresolvedId={unresolvedId}
        onPaste={drop.onPaste}
        embeds={embeds}
      />
      {scheduling ? (
        <ComposerSchedule
          value={scheduleLocal}
          onChange={setScheduleLocal}
          disabled={submitting}
          onPostNow={
            editing
              ? undefined
              : () => {
                  setScheduling(false);
                  setScheduleLocal("");
                }
          }
        />
      ) : null}
      {memberEmail && !editing ? (
        <MemberEmailField
          status={memberEmail}
          checked={emailMembers}
          disabled={submitting || scheduling}
          onChange={setEmailMembers}
        />
      ) : null}
      <ComposerAttachments
        attachments={attachments.attachments}
        onRemove={attachments.remove}
        disabled={submitting}
      />
      {shownError ? (
        <div id={errorId} role="alert" className="text-sm text-danger">
          {shownError}
        </div>
      ) : null}
      {confirmingDiscard ? (
        <DiscardConfirm
          keepRef={keepRef}
          onKeep={() => {
            focusTarget.current = "body";
            setConfirmingDiscard(false);
          }}
          onDiscard={cancel}
        />
      ) : null}
      <ComposerActionBar
        counter={
          <p
            id={counterId}
            className={cn(
              "text-xs tabular-nums",
              overLimit ? "font-medium text-danger" : "text-text-muted",
            )}
          >
            {overLimit
              ? `${formatCount(length - maxLength)} characters over the limit`
              : `${formatCount(length)} / ${formatCount(maxLength)}`}
          </p>
        }
        submitting={submitting}
        imagesFull={attachments.full}
        onAddImages={attachments.add}
        canSchedule={allowSchedule && !scheduling}
        onSchedule={() => setScheduling(true)}
        onCancel={requestCancel}
        canSubmit={canSubmit}
        onSubmit={() => void submit()}
        submitLabel={submitLabel ?? (scheduling ? "Schedule" : "Post")}
      />
    </div>
  );
}

export {
  PostComposer,
  postComposerLimits,
  type PostComposerCategory,
  type PostComposerInitial,
  type PostComposerMemberEmail,
  type PostComposerProps,
  type PostComposerSubmission,
};
