import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MyCommunityCard } from "./my-community-card";

const community = {
  id: "0192f0a0-0000-7000-8000-000000000001",
  slug: "makers",
  name: "Makers Guild",
  coverUrl: null,
  memberCount: 12,
};

describe("MyCommunityCard", () => {
  it("is one link to the community whose name starts with the community name, with no Open button", () => {
    const { container } = render(
      <ul>
        <MyCommunityCard community={community} role="owner" unread={3} />
      </ul>,
    );

    const link = screen.getByRole("link", { name: /^Makers Guild/ });
    expect(link.getAttribute("href")).toBe("/c/makers");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(container.querySelectorAll("a, button")).toHaveLength(1);
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("includes the role, unread count, and member count in the link text", () => {
    render(
      <ul>
        <MyCommunityCard community={community} role="admin" unread={120} />
      </ul>,
    );

    const link = screen.getByRole("link", { name: /^Makers Guild/ });
    expect(link.textContent).toBe("MMakers GuildAdmin99+ new12 members");
  });

  it("leaves the role out for members", () => {
    render(
      <ul>
        <MyCommunityCard community={community} role="member" unread={0} />
      </ul>,
    );

    expect(screen.queryByText("Member")).toBeNull();
  });

  it("shows the cover at a 4:1 crop", () => {
    const { container } = render(
      <ul>
        <MyCommunityCard
          community={{ ...community, coverUrl: "/api/uploads/cover.png" }}
          role="member"
          unread={0}
        />
      </ul>,
    );

    const cover = container.querySelector('img[src="/api/uploads/cover.png"]');
    expect(cover?.className).toContain("aspect-[4/1]");
    expect(cover?.className).toContain("object-cover");
  });

  it("shows the letter tile at the same 4:1 crop without a cover", () => {
    render(
      <ul>
        <MyCommunityCard community={community} role="member" unread={0} />
      </ul>,
    );

    expect(screen.getByText("M").parentElement?.className).toContain("aspect-[4/1]");
  });
});
