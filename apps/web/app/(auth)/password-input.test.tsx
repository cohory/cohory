import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  it("hides the password until the person presses Show, then hides it again", () => {
    render(
      <label>
        Password
        <PasswordInput name="password" />
      </label>,
    );
    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    expect(input.getAttribute("type")).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(input.getAttribute("type")).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(input.getAttribute("type")).toBe("password");
  });

  it("never submits the form it sits in", () => {
    render(<PasswordInput name="password" />);
    expect(screen.getByRole("button", { name: "Show password" }).getAttribute("type")).toBe(
      "button",
    );
  });
});
