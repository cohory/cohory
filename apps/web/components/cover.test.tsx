import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommunityCover } from "./cover";

describe("CommunityCover", () => {
  it("loads list covers lazily so they do not compete with the page above the fold", () => {
    const { container } = render(
      <CommunityCover name="Makers Guild" coverUrl="/api/uploads/cover.png" />,
    );

    const cover = container.querySelector("img");
    expect(cover?.getAttribute("loading")).toBe("lazy");
    expect(cover?.getAttribute("decoding")).toBe("async");
  });
});
