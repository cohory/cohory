import { ApprovalsError } from "@cohory/agents/approvals";
import { toApiError } from "@cohory/api";
import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { CalendarNotFoundError } from "@cohory/calendar";
import {
  CommunityArchivedError,
  CommunityNotFoundError,
  InviteUnavailableError,
  JoinRequestNotFoundError,
  SlugChangeTooSoonError,
  SlugReservedError,
  SlugTakenError,
} from "@cohory/communities";
import { CourseNotFoundError } from "@cohory/courses";
import { LimitReachedError } from "@cohory/fair-use";
import { MemberNotFoundError, UsernameReservedError, UsernameTakenError } from "@cohory/members";
import {
  AlreadySubscribedError,
  CurrencyLockedError,
  ManualCancellationRequiredError,
  PaidSignupsPausedError,
  PaymentsUnavailableError,
  StripeRejectedError,
} from "@cohory/payments";
import { CategoryLimitError, PinLimitError, PostNotScheduledError } from "@cohory/posts";
import { RateLimitedError } from "@cohory/rate-limit";
import { AlreadyReviewedError, NotEligibleError, ReviewsDisabledError } from "@cohory/reviews";
import { StorageError } from "@cohory/storage";
import { WebhookEndpointLimitError } from "@cohory/webhooks";
import { describe, expect, it } from "vitest";

import { calendarActionFailure } from "../calendar/errors";
import { courseActionFailure } from "../courses/errors";
import { manageActionFailure } from "../manage/errors";
import { paymentsActionFailure } from "../payments/errors";
import { actionFailure, archivedMessage } from "./errors";

describe("actionFailure", () => {
  it("tells members an archived community is read only", () => {
    const error = new CommunityArchivedError();

    expect(actionFailure(error)).toEqual({ ok: false, message: archivedMessage });
    expect(calendarActionFailure(error)).toEqual({ ok: false, message: archivedMessage });
    expect(courseActionFailure(error)).toEqual({ ok: false, message: archivedMessage });
  });

  it("tells the creator how to restore an archived community", () => {
    expect(manageActionFailure(new CommunityArchivedError())?.message).toBe(
      toApiError(new CommunityArchivedError()).message,
    );
  });

  it("leaves errors outside the catalog to the caller", () => {
    expect(actionFailure(new Error("boom"))).toBeNull();
  });
});

describe("one error catalog for the API and the web app", () => {
  const sameOnBothSurfaces: readonly Error[] = [
    new UnauthenticatedError(),
    new ForbiddenError("update", "community"),
    new RateLimitedError("signIn", 45),
    new LimitReachedError("members", 500, 500),
    new ApprovalsError("expired"),
    new CommunityNotFoundError(),
    new JoinRequestNotFoundError(),
    new SlugTakenError("design"),
    new SlugReservedError("admin"),
    new SlugChangeTooSoonError(new Date("2026-11-20T09:00:00Z")),
    new InviteUnavailableError(),
    new PinLimitError(3),
    new CategoryLimitError(10),
    new PostNotScheduledError(),
    new MemberNotFoundError(),
    new UsernameTakenError("ada"),
    new UsernameReservedError("admin"),
    new ReviewsDisabledError(),
    new AlreadyReviewedError(),
    new NotEligibleError("Stay a member for 7 days before you review."),
    new CourseNotFoundError("lesson"),
    new CalendarNotFoundError(),
    new WebhookEndpointLimitError(20),
    new StorageError("file_too_large", "The file is over 25 MB. Choose a smaller file."),
    new StorageError(
      "image_too_large",
      "This image has too many pixels. Use one under 25 megapixels.",
    ),
    new StorageError("image_unreadable", "This image could not be read."),
    new CurrencyLockedError(),
    new AlreadySubscribedError(),
    new StripeRejectedError("card_declined"),
    new ManualCancellationRequiredError(3),
  ];

  it.each(sameOnBothSurfaces.map((error) => [error.name, error] as const))(
    "gives %s the same message in a server action and in the API",
    (_name, error) => {
      const api = toApiError(error);
      expect(api.status).not.toBe(500);
      expect(actionFailure(error)?.message).toBe(api.message);
      expect(manageActionFailure(error)?.message).toBe(api.message);
      expect(paymentsActionFailure(error, "member")?.message).toBe(api.message);
    },
  );

  it("uses the API message as the default and adds a variant only for one audience", () => {
    const unavailable = new PaymentsUnavailableError("STRIPE_SECRET_KEY");
    expect(paymentsActionFailure(unavailable, "creator")?.message).toBe(
      toApiError(unavailable).message,
    );
    expect(paymentsActionFailure(unavailable, "member")?.message).toBe(
      "Memberships are not for sale right now. Try again later.",
    );

    const paused = new PaidSignupsPausedError();
    expect(paymentsActionFailure(paused, "member")?.message).toBe(toApiError(paused).message);
    expect(paymentsActionFailure(paused, "creator")?.message).toContain(
      "Existing members keep access",
    );
  });
});
