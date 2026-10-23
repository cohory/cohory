import { ApprovalsError } from "@cohory/agents/approvals";
import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import { CalendarValidationError } from "@cohory/calendar";
import {
  CommunityArchivedError,
  CommunityValidationError,
  InviteUnavailableError,
  PaymentRequiredError,
  SlugChangeTooSoonError,
} from "@cohory/communities";
import { MembersValidationError } from "@cohory/members";
import { PaidSignupsPausedError, PaymentsUnavailableError } from "@cohory/payments";
import { PostValidationError } from "@cohory/posts";
import { RateLimitedError } from "@cohory/rate-limit";
import { ReviewsValidationError } from "@cohory/reviews";
import { describe, expect, it } from "vitest";

import { toApiError } from "../errors";
import { describeError, kindStatus } from "./describe";

const issues = [{ path: "name", message: "Use 2 to 80 characters." }];

describe("the shared error catalog", () => {
  it.each([
    new CommunityValidationError(issues),
    new PostValidationError(issues),
    new MembersValidationError(issues),
    new ReviewsValidationError(issues),
    new CalendarValidationError(issues),
  ])("reads issues from any module validation error ($name)", (error) => {
    expect(describeError(error)).toEqual({
      kind: "validation",
      code: "validation_failed",
      message: "Some fields are not valid. Check them and try again.",
      details: issues,
      issues,
    });
  });

  it.each([
    [new UnauthenticatedError(), 401],
    [new PaymentRequiredError(), 402],
    [new ForbiddenError("update", "community"), 403],
    [new ApprovalsError("not_found"), 404],
    [new CommunityArchivedError(), 409],
    [new InviteUnavailableError(), 410],
    [new RateLimitedError("signIn", 30), 429],
    [new PaymentsUnavailableError("STRIPE_SECRET_KEY"), 503],
  ])("maps the kind of %s to HTTP status %i", (error, status) => {
    const described = describeError(error);
    expect(described && kindStatus[described.kind]).toBe(status);
    expect(toApiError(error).status).toBe(status);
  });

  it("uses an audience variant only when the caller names that audience", () => {
    const error = new PaidSignupsPausedError();
    expect(describeError(error)?.message).toBe(
      "New memberships are paused in this community for now. Try again later.",
    );
    expect(describeError(error, "member")?.message).toBe(
      "New memberships are paused in this community for now. Try again later.",
    );
    expect(describeError(error, "creator")?.message).toBe(
      "New paid signups are paused until the platform invoice is paid. Existing members keep access.",
    );
  });

  it("builds messages from the error's own data", () => {
    expect(describeError(new SlugChangeTooSoonError(new Date("2026-11-20T09:00:00Z")))).toEqual({
      kind: "conflict",
      code: "slug_change_too_soon",
      message: "You can change the community URL again on 20 November 2026.",
    });
    expect(toApiError(new RateLimitedError("signIn", 90))).toMatchObject({
      status: 429,
      message: "You're doing that too often. Try again in 2 minutes.",
      retryAfterSeconds: 90,
    });
  });

  it("returns null for errors it does not know, so callers can treat them as internal", () => {
    expect(describeError(new Error("boom"))).toBeNull();
    expect(toApiError(new Error("boom"))).toMatchObject({ status: 500, code: "internal_error" });
  });
});
