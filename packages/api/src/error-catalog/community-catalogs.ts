import {
  CommunitiesError,
  GalleryItemNotFoundError,
  InviteNotFoundError,
  JoinRequestNotFoundError,
  MembershipNotFoundError,
  SlugChangeTooSoonError,
  type CommunitiesErrorCode,
} from "@cohory/communities";
import { CalendarError, type CalendarErrorCode } from "@cohory/calendar";
import { CourseNotFoundError, CoursesError, type CoursesErrorCode } from "@cohory/courses";
import { GamificationError, type GamificationErrorCode } from "@cohory/gamification";
import { MembersError, type MembersErrorCode } from "@cohory/members";
import { MigrationError, type MigrationErrorCode } from "@cohory/migration";
import {
  CategoryLimitError,
  CategoryNotFoundError,
  CommentNotFoundError,
  PinLimitError,
  PostsError,
  type PostsErrorCode,
} from "@cohory/posts";
import { NotEligibleError, ReviewsError, type ReviewsErrorCode } from "@cohory/reviews";
import { StorageError, type StorageErrorCode } from "@cohory/storage";
import { WebhooksError, type WebhooksErrorCode } from "@cohory/webhooks";

import { fromCatalog, fromClass } from "./match";
import type { Catalog, ErrorMatcher } from "./types";

type Codes<C extends string> = Exclude<C, "validation_failed">;

const utcDay = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

export const archivedForMembersMessage =
  "This community is archived. You can read everything, but nothing new can be added.";

function communityNotFound(error: CommunitiesError): string {
  if (error instanceof MembershipNotFoundError) {
    return "This person is not a member of the community.";
  }
  if (error instanceof JoinRequestNotFoundError) {
    return "Someone already answered this request.";
  }
  if (error instanceof GalleryItemNotFoundError) {
    return "This item is no longer in the gallery.";
  }
  if (error instanceof InviteNotFoundError) {
    return "We could not find that invite.";
  }
  return "We could not find that community.";
}

export const communitiesCatalog = {
  not_found: { kind: "not_found", message: communityNotFound },
  slug_taken: {
    kind: "conflict",
    message: "That URL is taken or was used by another community before. Try a different one.",
  },
  slug_reserved: { kind: "validation", message: "That URL is reserved. Try a different one." },
  slug_change_too_soon: {
    kind: "conflict",
    message: (error) =>
      error instanceof SlugChangeTooSoonError
        ? `You can change the community URL again on ${utcDay.format(error.availableAt)}.`
        : "The community URL can change once every 30 days. Try again later.",
  },
  owner_cannot_leave: { kind: "conflict", message: "The owner cannot leave their own community." },
  community_archived: {
    kind: "conflict",
    message: "This community is archived. Restore it in Settings to make changes.",
    member: archivedForMembersMessage,
  },
  community_not_archived: {
    kind: "conflict",
    message: "Archive the community before you delete it.",
  },
  deletion_conflict: {
    kind: "conflict",
    message: "Payment records changed while we were deleting this community. Try again.",
  },
  invite_unavailable: {
    kind: "gone",
    message: "This invite link has expired or is no longer active. Ask for a new one.",
  },
  payment_required: {
    kind: "payment_required",
    message: "This community needs a paid membership. Choose a plan to join.",
  },
  approval_required: {
    kind: "conflict",
    message: "This community reviews new members. Send a request to join instead.",
  },
  invite_only: {
    kind: "forbidden",
    message: "This community is invite only. Ask a member for an invite link.",
  },
  community_creation_restricted: {
    kind: "forbidden",
    message: "Only the people who run this server can create communities.",
  },
} satisfies Catalog<Codes<CommunitiesErrorCode>, CommunitiesError>;

function postNotFound(error: PostsError): string {
  if (error instanceof CommentNotFoundError) return "We could not find that comment.";
  if (error instanceof CategoryNotFoundError) return "That category no longer exists.";
  return "We could not find that post.";
}

export const postsCatalog = {
  not_found: { kind: "not_found", message: postNotFound },
  pin_limit_reached: {
    kind: "conflict",
    message: (error) =>
      `You can pin up to ${error instanceof PinLimitError ? error.limit : 3} posts. Unpin one first.`,
  },
  category_limit_reached: {
    kind: "conflict",
    message: (error) =>
      `A community can have up to ${error instanceof CategoryLimitError ? error.limit : 10} categories. Remove one first.`,
  },
  invalid_parent: {
    kind: "validation",
    message: "You can only reply to a top level comment on the same post.",
  },
  post_not_scheduled: { kind: "conflict", message: "This post is already published." },
  member_email_too_soon: {
    kind: "conflict",
    message: "A post was already emailed to all members in the last 24 hours. Try again later.",
  },
} satisfies Catalog<Codes<PostsErrorCode>, PostsError>;

export const reviewsCatalog = {
  not_found: { kind: "not_found", message: "We could not find that review." },
  reviews_disabled: { kind: "conflict", message: "Reviews are turned off in this community." },
  not_eligible: {
    kind: "forbidden",
    message: (error) =>
      error instanceof NotEligibleError
        ? error.userMessage
        : "You cannot review this community yet.",
  },
  already_reviewed: {
    kind: "conflict",
    message: "You already reviewed this community. Edit your review instead.",
  },
  reply_exists: {
    kind: "conflict",
    message: "This review already has your reply. Edit it instead.",
  },
  not_reported: {
    kind: "conflict",
    message: "You can only hide a review that someone reported.",
  },
} satisfies Catalog<Codes<ReviewsErrorCode>, ReviewsError>;

export const membersCatalog = {
  not_found: { kind: "not_found", message: "We could not find that member." },
  username_taken: { kind: "conflict", message: "That username is taken. Try a different one." },
  username_reserved: {
    kind: "validation",
    message: "That username is reserved. Try a different one.",
  },
} satisfies Catalog<Codes<MembersErrorCode>, MembersError>;

export const gamificationCatalog = {
  not_found: { kind: "not_found", message: "We could not find that community." },
} satisfies Catalog<Codes<GamificationErrorCode>, GamificationError>;

export const coursesCatalog = {
  not_found: { kind: "not_found", message: "We could not find that course or lesson." },
} satisfies Catalog<Codes<CoursesErrorCode>, CoursesError>;

export const calendarCatalog = {
  not_found: { kind: "not_found", message: "We could not find that event." },
} satisfies Catalog<Codes<CalendarErrorCode>, CalendarError>;

const migrationMessage = (error: MigrationError): string => error.message;
const migrationIssues = (error: MigrationError) => error.issues;
const migrationDetails = (error: MigrationError) =>
  error.issues.length > 0 ? error.issues : undefined;

export const migrationCatalog = {
  not_found: { kind: "not_found", message: "We could not find that job or file." },
  validation_failed: {
    kind: "validation",
    message: migrationMessage,
    details: migrationDetails,
    issues: migrationIssues,
  },
  invalid_archive: {
    kind: "validation",
    message: migrationMessage,
    details: migrationDetails,
    issues: migrationIssues,
  },
  unsupported_schema_version: {
    kind: "validation",
    message: migrationMessage,
    details: migrationDetails,
  },
  checksum_mismatch: {
    kind: "validation",
    message: "The archive is damaged or was changed after export. Export it again.",
    details: migrationDetails,
  },
  archive_too_large: { kind: "validation", message: migrationMessage, details: migrationDetails },
  community_not_empty: { kind: "conflict", message: migrationMessage, details: migrationDetails },
  job_not_ready: { kind: "conflict", message: migrationMessage, details: migrationDetails },
  job_in_progress: { kind: "conflict", message: migrationMessage, details: migrationDetails },
  invalid_csv: {
    kind: "validation",
    message: migrationMessage,
    details: migrationDetails,
    issues: migrationIssues,
  },
  daily_email_limit: { kind: "rate_limited", message: migrationMessage },
} satisfies Catalog<MigrationErrorCode, MigrationError>;

export const webhooksCatalog = {
  not_found: {
    kind: "not_found",
    message: "We could not find that webhook endpoint or delivery.",
  },
  endpoint_limit_reached: {
    kind: "conflict",
    message: "This community already has 20 webhook endpoints. Delete one first.",
  },
  endpoint_disabled: {
    kind: "conflict",
    message: "This endpoint is turned off. Turn it on before sending or resending events.",
  },
} satisfies Catalog<WebhooksErrorCode, WebhooksError>;

const storageMessage = (error: StorageError): string => error.message;

export const storageCatalog = {
  invalid_key: { kind: "validation", message: storageMessage },
  file_too_large: { kind: "validation", message: storageMessage },
  unsupported_type: { kind: "validation", message: storageMessage },
  content_mismatch: { kind: "validation", message: storageMessage },
  invalid_config: { kind: "validation", message: storageMessage },
  image_too_large: { kind: "validation", message: storageMessage },
  image_unreadable: { kind: "validation", message: storageMessage },
} satisfies Catalog<StorageErrorCode, StorageError>;

export const migrationMatcher: ErrorMatcher = fromCatalog(MigrationError, migrationCatalog);

export const communityMatchers: readonly ErrorMatcher[] = [
  fromClass(
    CourseNotFoundError,
    "link_expired",
    {
      kind: "not_found",
      message: "This download link expired or is not valid. Ask for a new one.",
    },
    (error) => error.subject === "agent_download",
  ),
  fromCatalog(CommunitiesError, communitiesCatalog),
  fromCatalog(PostsError, postsCatalog),
  fromCatalog(ReviewsError, reviewsCatalog),
  fromCatalog(MembersError, membersCatalog),
  fromCatalog(GamificationError, gamificationCatalog),
  fromCatalog(CoursesError, coursesCatalog),
  fromCatalog(CalendarError, calendarCatalog),
  fromCatalog(WebhooksError, webhooksCatalog),
  fromCatalog(StorageError, storageCatalog),
];
