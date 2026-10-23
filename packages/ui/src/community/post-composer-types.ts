import type { ReactNode } from "react";

import type { MemberEmailStatus } from "./composer-prompts";
import type { PostDocument } from "./content";
import type { MentionSearch } from "./mention-suggestions";
import type { MentionResolver } from "./resolve-mentions";
import type { UploadedImage } from "./use-image-attachments";

interface PostComposerSubmission {
  title: string | null;
  document: PostDocument;
  categoryId: string | null;
  scheduledAt: string | null;
  emailMembers: boolean;
}

interface PostComposerInitial {
  title: string | null;
  text: string;
  categoryId: string | null;
  scheduledAt: string | null;
  images: readonly UploadedImage[];
}

type PostComposerMemberEmail = MemberEmailStatus;

interface PostComposerCategory {
  id: string;
  name: string;
}

interface PostComposerDraft {
  title: string;
  text: string;
  categoryId: string;
  scheduleLocal: string;
}

function parsePostComposerDraft(raw: unknown): PostComposerDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const draft: Partial<Record<keyof PostComposerDraft, unknown>> = raw;
  const { title, text, categoryId, scheduleLocal } = draft;
  if (typeof title !== "string" || typeof text !== "string") return null;
  if (typeof categoryId !== "string" || typeof scheduleLocal !== "string") return null;
  return { title, text, categoryId, scheduleLocal };
}

interface PostComposerProps {
  onSubmit(input: PostComposerSubmission): Promise<void> | void;
  onUploadImage(file: File): Promise<UploadedImage>;
  onResolveMention?: MentionResolver;
  onSearchMentions?: MentionSearch;
  onCancel?(): void;
  viewer?: { name: string; avatarUrl?: string | null };
  placeholder?: string;
  showTitle?: boolean;
  maxLength?: number;
  maxTitleLength?: number;
  draftKey?: string;
  maxImages?: number;
  canPost?: boolean;
  disabledReason?: string;
  error?: ReactNode;
  defaultExpanded?: boolean;
  categories?: readonly PostComposerCategory[];
  defaultCategoryId?: string | null;
  allowSchedule?: boolean;
  memberEmail?: PostComposerMemberEmail | null;
  initial?: PostComposerInitial;
  label?: string;
  submitLabel?: string;
  className?: string;
}

const postComposerLimits = { title: 120 } as const;

export {
  parsePostComposerDraft,
  postComposerLimits,
  type PostComposerCategory,
  type PostComposerDraft,
  type PostComposerInitial,
  type PostComposerMemberEmail,
  type PostComposerProps,
  type PostComposerSubmission,
};
