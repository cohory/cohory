import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Link, LinkProvider, type LinkProps } from "./link";

function RouterLink(props: LinkProps) {
  return <a data-router="" {...props} />;
}

describe("Link", () => {
  it("renders a plain anchor when no provider is mounted", () => {
    render(<Link href="/c/design">Design</Link>);

    const link = screen.getByRole("link", { name: "Design" });
    expect(link.getAttribute("href")).toBe("/c/design");
    expect(link.hasAttribute("data-router")).toBe(false);
  });

  it("renders the provided router link component", () => {
    render(
      <LinkProvider component={RouterLink}>
        <Link href="/c/design" rel="next">
          Design
        </Link>
      </LinkProvider>,
    );

    const link = screen.getByRole("link", { name: "Design" });
    expect(link.hasAttribute("data-router")).toBe(true);
    expect(link.getAttribute("rel")).toBe("next");
  });

  it("forwards the ref to the anchor", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Link ref={ref} href="/c/design">
        Design
      </Link>,
    );

    expect(ref.current?.tagName).toBe("A");
  });
});
