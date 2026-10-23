import { describe, expect, it, vi } from "vitest";

import { noSignUpLookups, signUpGate, type SignUpLookups } from "./sign-up-gate";

const token = "A".repeat(43);

function lookups(active = true): SignUpLookups & { inviteActive: ReturnType<typeof vi.fn> } {
  return { inviteActive: vi.fn(async () => active) };
}

describe("signUpGate", () => {
  it("lets anyone sign up when sign up is open", async () => {
    const gate = signUpGate("open", lookups());
    expect(await gate("/")).toBe(true);
    expect(await gate(undefined)).toBe(true);
  });

  it("refuses every sign up when sign up is closed, even through an invite", async () => {
    const gate = signUpGate("closed", lookups());
    expect(await gate("/")).toBe(false);
    expect(await gate(`/join/${token}?accept=1`)).toBe(false);
  });

  it("lets a person with an active invite sign up when sign up is by invite", async () => {
    const found = lookups();
    const gate = signUpGate("invite", found);
    expect(await gate(`/join/${token}?accept=1`)).toBe(true);
    expect(await gate(`/join/${token}`)).toBe(true);
    expect(found.inviteActive).toHaveBeenCalledWith(token);
  });

  it("refuses an expired, used up, revoked, or unknown invite when sign up is by invite", async () => {
    const gate = signUpGate("invite", lookups(false));
    expect(await gate(`/join/${token}?accept=1`)).toBe(false);
  });

  it("refuses a join from a community page without looking the community up", async () => {
    const found = lookups();
    const gate = signUpGate("invite", found);
    expect(await gate("/c/makers-guild/join?intent=join")).toBe(false);
    expect(await gate("/c/makers-guild/join?intent=checkout")).toBe(false);
    expect(found.inviteActive).not.toHaveBeenCalled();
  });

  it("refuses a plain sign up or a made up path when sign up is by invite", async () => {
    const found = lookups();
    const gate = signUpGate("invite", found);
    expect(await gate("/")).toBe(false);
    expect(await gate("/communities/new")).toBe(false);
    expect(await gate("/join/short")).toBe(false);
    expect(await gate(`https://evil.example/join/${token}`)).toBe(false);
    expect(found.inviteActive).not.toHaveBeenCalled();
  });

  it("refuses every invite when the app gave no lookups", async () => {
    expect(await signUpGate("invite", noSignUpLookups)(`/join/${token}?accept=1`)).toBe(false);
  });
});
