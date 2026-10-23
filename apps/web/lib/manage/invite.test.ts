import { ForbiddenError, UnauthenticatedError } from "@cohory/authz";
import {
  CommunityArchivedError,
  InviteNotFoundError,
  InviteUnavailableError,
  MembershipNotFoundError,
} from "@cohory/communities";
import { describe, expect, it } from "vitest";

import { inviteFailureMessage, inviteMessages, invitePreviewMessage } from "./invite";

describe("inviteFailureMessage", () => {
  it("explains expired, revoked, used up, and unknown links the same way", () => {
    expect(inviteFailureMessage(new InviteUnavailableError())).toBe(inviteMessages.unavailable);
    expect(inviteFailureMessage(new InviteNotFoundError())).toBe(inviteMessages.unavailable);
  });

  it("tells a banned person they can't join without saying why", () => {
    expect(inviteFailureMessage(new ForbiddenError("join", "membership"))).toBe(
      "You can't join this community.",
    );
  });

  it("explains an archived community", () => {
    expect(inviteFailureMessage(new CommunityArchivedError())).toBe(inviteMessages.archived);
  });

  it("asks a signed out person to sign in", () => {
    expect(inviteFailureMessage(new UnauthenticatedError())).toBe(inviteMessages.signedOut);
  });

  it("leaves unexpected errors to the error boundary", () => {
    expect(inviteFailureMessage(new MembershipNotFoundError())).toBeNull();
    expect(inviteFailureMessage(new Error("boom"))).toBeNull();
  });
});

describe("invitePreviewMessage", () => {
  const community = { slug: "makers", name: "Makers" };

  it("says nothing for a working link", () => {
    expect(invitePreviewMessage({ community, status: "active" })).toBeNull();
  });

  it("explains an unknown, expired, revoked, or used up link the same way", () => {
    expect(invitePreviewMessage(null)).toBe(inviteMessages.unavailable);
    for (const status of ["expired", "revoked", "used_up"] as const) {
      expect(invitePreviewMessage({ community, status })).toBe(inviteMessages.unavailable);
    }
  });

  it("names the archive as the reason when the community is archived", () => {
    expect(invitePreviewMessage({ community, status: "archived" })).toBe(inviteMessages.archived);
  });
});
