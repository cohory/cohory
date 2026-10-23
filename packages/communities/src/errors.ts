export type CommunitiesErrorCode =
  | "not_found"
  | "slug_taken"
  | "slug_reserved"
  | "slug_change_too_soon"
  | "owner_cannot_leave"
  | "validation_failed"
  | "community_archived"
  | "community_not_archived"
  | "deletion_conflict"
  | "invite_unavailable"
  | "payment_required"
  | "approval_required"
  | "invite_only"
  | "community_creation_restricted";

export abstract class CommunitiesError extends Error {
  abstract readonly code: CommunitiesErrorCode;
}

export class CommunityNotFoundError extends CommunitiesError {
  readonly code = "not_found";

  constructor() {
    super("community not found");
    this.name = "CommunityNotFoundError";
  }
}

export class CommunityCreationRestrictedError extends CommunitiesError {
  readonly code = "community_creation_restricted";

  constructor() {
    super("only the operators of this server can create communities");
    this.name = "CommunityCreationRestrictedError";
  }
}

export class MembershipNotFoundError extends CommunitiesError {
  readonly code = "not_found";

  constructor() {
    super("membership not found");
    this.name = "MembershipNotFoundError";
  }
}

export class SlugTakenError extends CommunitiesError {
  readonly code = "slug_taken";

  constructor(readonly slug: string) {
    super(`slug ${slug} is taken`);
    this.name = "SlugTakenError";
  }
}

export class SlugReservedError extends CommunitiesError {
  readonly code = "slug_reserved";

  constructor(readonly slug: string) {
    super(`slug ${slug} is reserved`);
    this.name = "SlugReservedError";
  }
}

export class SlugChangeTooSoonError extends CommunitiesError {
  readonly code = "slug_change_too_soon";

  constructor(readonly availableAt: Date) {
    super(`the community URL can change again on ${availableAt.toISOString()}`);
    this.name = "SlugChangeTooSoonError";
  }
}

export class OwnerCannotLeaveError extends CommunitiesError {
  readonly code = "owner_cannot_leave";

  constructor() {
    super("the owner cannot leave the community");
    this.name = "OwnerCannotLeaveError";
  }
}

export class CommunityDeletionConflictError extends CommunitiesError {
  readonly code = "deletion_conflict";

  constructor() {
    super("payment records changed while the community was being deleted");
    this.name = "CommunityDeletionConflictError";
  }
}

export class PaymentRequiredError extends CommunitiesError {
  readonly code = "payment_required";

  constructor() {
    super("this community needs a paid membership");
    this.name = "PaymentRequiredError";
  }
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class CommunityValidationError extends CommunitiesError {
  readonly code = "validation_failed";

  constructor(readonly issues: readonly ValidationIssue[]) {
    super("community input is invalid");
    this.name = "CommunityValidationError";
  }
}

export class CommunityArchivedError extends CommunitiesError {
  readonly code = "community_archived";

  constructor() {
    super("the community is archived");
    this.name = "CommunityArchivedError";
  }
}

export class CommunityNotArchivedError extends CommunitiesError {
  readonly code = "community_not_archived";

  constructor() {
    super("the community must be archived before it can be deleted");
    this.name = "CommunityNotArchivedError";
  }
}

export class InviteUnavailableError extends CommunitiesError {
  readonly code = "invite_unavailable";

  constructor() {
    super("the invite link is expired, revoked, or used up");
    this.name = "InviteUnavailableError";
  }
}

export class InviteNotFoundError extends CommunitiesError {
  readonly code = "not_found";

  constructor() {
    super("invite link not found");
    this.name = "InviteNotFoundError";
  }
}

export class ApprovalRequiredError extends CommunitiesError {
  readonly code = "approval_required";

  constructor() {
    super("this community reviews join requests");
    this.name = "ApprovalRequiredError";
  }
}

export class InviteOnlyError extends CommunitiesError {
  readonly code = "invite_only";

  constructor() {
    super("this community accepts members by invite only");
    this.name = "InviteOnlyError";
  }
}

export class JoinRequestNotFoundError extends CommunitiesError {
  readonly code = "not_found";

  constructor() {
    super("join request not found");
    this.name = "JoinRequestNotFoundError";
  }
}

export class GalleryItemNotFoundError extends CommunitiesError {
  readonly code = "not_found";

  constructor() {
    super("gallery item not found");
    this.name = "GalleryItemNotFoundError";
  }
}
