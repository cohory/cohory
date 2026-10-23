import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommunityNotFound } from "./not-found-panel";

const visitor = vi.hoisted(() => ({ signedIn: false }));

vi.mock("../lib/session", () => ({
  currentSession: vi.fn(async () => (visitor.signedIn ? { user: { id: "user-1" } } : null)),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommunityNotFound", () => {
  it("sends a signed out visitor home", async () => {
    visitor.signedIn = false;

    render(await CommunityNotFound());

    expect(screen.getByRole("link", { name: "Go to home" }).getAttribute("href")).toBe("/");
  });

  it("sends a signed in person to their communities", async () => {
    visitor.signedIn = true;

    render(await CommunityNotFound());

    expect(screen.getByRole("link", { name: "Go to my communities" })).toBeTruthy();
  });
});
