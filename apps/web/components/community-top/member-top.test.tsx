import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberTop } from "./member-top";

vi.mock("../community-menu", () => ({ CommunityMenu: () => null }));

describe("MemberTop", () => {
  it("shows the name row without any cover or letter tile", () => {
    const { container } = render(
      <MemberTop
        slug="makers"
        name="Makers Guild"
        memberCount={12}
        privacy="public"
        role="member"
        canManage={false}
        canLeave
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Makers Guild" })).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-slot="community-cover"]')).toBeNull();
    expect(container.querySelector(".bg-accent-muted")).toBeNull();
  });
});
