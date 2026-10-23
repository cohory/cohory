import type * as communities from "@cohory/communities";
import { afterEach, describe, expect, it, vi } from "vitest";

import { communitySignUpLookups } from "./sign-up-lookups";

const manage = vi.hoisted(() => ({ previewInvite: vi.fn() }));

vi.mock("@cohory/communities", async (importOriginal) => ({
  ...(await importOriginal<typeof communities>()),
  getManageService: () => manage,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("communitySignUpLookups", () => {
  it("counts an active invite", async () => {
    manage.previewInvite.mockResolvedValue({ status: "active" });
    expect(await communitySignUpLookups.inviteActive("a")).toBe(true);
  });

  it.each(["expired", "used_up", "revoked", "archived"])(
    "refuses an invite that is %s",
    async (status) => {
      manage.previewInvite.mockResolvedValue({ status });
      expect(await communitySignUpLookups.inviteActive("a")).toBe(false);
    },
  );

  it("refuses an unknown invite", async () => {
    manage.previewInvite.mockResolvedValue(null);
    expect(await communitySignUpLookups.inviteActive("a")).toBe(false);
  });
});
