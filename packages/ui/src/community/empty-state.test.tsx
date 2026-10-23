import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title, description, and action", () => {
    const markup = renderToStaticMarkup(
      <EmptyState
        title="No posts yet"
        description="Be the first to say hello."
        action={<button type="button">Write something</button>}
      />,
    );

    expect(markup).toContain("No posts yet");
    expect(markup).toContain("Be the first to say hello.");
    expect(markup).toContain("Write something");
  });
});
