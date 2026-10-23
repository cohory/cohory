import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BrandingUpload } from "./branding-upload";

function upload(frame: "logo" | "cover") {
  return render(
    <BrandingUpload
      label="Cover image"
      description="Hint"
      frame={frame}
      imageUrl="/api/uploads/cover.png"
      onUpload={vi.fn()}
      onRemove={vi.fn()}
      onDone={vi.fn()}
    />,
  );
}

describe("BrandingUpload", () => {
  it("previews a cover with the same 4:1 crop the About page uses", () => {
    const { container } = upload("cover");

    expect(container.querySelector('[data-slot="branding-preview"]')?.className).toContain(
      "aspect-[4/1]",
    );
    expect(container.querySelector("img")?.className).toContain("object-cover");
  });

  it("previews a logo whole inside a fixed height frame", () => {
    const { container } = upload("logo");

    expect(container.querySelector('[data-slot="branding-preview"]')?.className).toContain("h-28");
    expect(container.querySelector("img")?.className).toContain("object-contain");
  });
});
