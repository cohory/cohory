import {
  MemberNotFoundError,
  MembersValidationError,
  UsernameReservedError,
  UsernameTakenError,
} from "@cohory/members";
import { describe, expect, it } from "vitest";

import { membersActionFailure } from "./errors";

describe("members action errors", () => {
  it("says a taken username is taken", () => {
    expect(membersActionFailure(new UsernameTakenError("ada"))).toEqual({
      ok: false,
      message: "That username is taken. Try a different one.",
    });
  });

  it("explains reserved usernames and validation issues", () => {
    expect(membersActionFailure(new UsernameReservedError("admin"))?.message).toMatch(/reserved/);
    expect(
      membersActionFailure(
        new MembersValidationError([{ path: "bio", message: "Keep the bio short." }]),
      )?.message,
    ).toBe("Keep the bio short.");
  });

  it("says a missing member was not found and leaves unknown errors alone", () => {
    expect(membersActionFailure(new MemberNotFoundError())?.message).toBe(
      "We could not find that member.",
    );
    expect(membersActionFailure(new Error("boom"))).toBeNull();
  });
});
