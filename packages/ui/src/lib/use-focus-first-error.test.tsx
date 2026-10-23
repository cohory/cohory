import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFocusFirstError } from "./use-focus-first-error";

type Errors = Partial<Record<"name" | "url", string>>;

function Form({ errors }: { errors: Errors }) {
  const ref = useFocusFirstError<HTMLFormElement>(errors);
  return (
    <form ref={ref}>
      <input aria-label="Name" aria-invalid={errors.name ? true : undefined} />
      <input aria-label="URL" aria-invalid={errors.url ? true : undefined} />
      <button type="submit">Create</button>
    </form>
  );
}

describe("useFocusFirstError", () => {
  it("moves focus to the first invalid field when errors arrive", () => {
    const { rerender } = render(<Form errors={{}} />);
    screen.getByRole("button", { name: "Create" }).focus();

    rerender(<Form errors={{ url: "That URL is already taken." }} />);

    expect(document.activeElement).toBe(screen.getByLabelText("URL"));
  });

  it("picks the first invalid field in document order", () => {
    const { rerender } = render(<Form errors={{}} />);

    rerender(<Form errors={{ url: "Taken.", name: "Enter a name." }} />);

    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("leaves focus alone on first render and when there are no errors", () => {
    const { rerender } = render(<Form errors={{ name: "Enter a name." }} />);
    const button = screen.getByRole("button", { name: "Create" });
    button.focus();

    rerender(<Form errors={{}} />);

    expect(document.activeElement).toBe(button);
  });
});
