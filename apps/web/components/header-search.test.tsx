import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeaderSearchPlaceholder } from "./header-search";

describe("HeaderSearchPlaceholder", () => {
  it("reserves the same space as the search field and phone button", () => {
    const { container } = render(<HeaderSearchPlaceholder />);

    const boxes = [...container.querySelectorAll("[aria-hidden='true']")].map(
      (node) => node.className,
    );
    expect(boxes).toEqual([
      expect.stringContaining("hidden h-11 w-48 md:block lg:w-64"),
      expect.stringContaining("size-11 md:hidden"),
    ]);
  });
});
