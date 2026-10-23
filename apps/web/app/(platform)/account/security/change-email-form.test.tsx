import { authClient } from "@cohory/auth/client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeEmailForm } from "./change-email-form";

vi.mock("@cohory/auth/client", () => ({ authClient: { changeEmail: vi.fn() } }));

const changeEmail = vi.mocked(authClient.changeEmail);

afterEach(() => {
  vi.clearAllMocks();
});

async function submit(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "New email address" }), {
    target: { value },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  });
}

describe("ChangeEmailForm", () => {
  it("asks the current address to approve the move first and says it stays until then", async () => {
    changeEmail.mockResolvedValue({ data: { status: true }, error: null });
    render(<ChangeEmailForm currentEmail="ada@example.com" />);

    await submit("ada.new@example.com");

    expect(changeEmail).toHaveBeenCalledWith({
      newEmail: "ada.new@example.com",
      callbackURL: "/account/security",
    });
    expect(screen.getByRole("status").textContent).toContain(
      "To approve the change, open the link we sent to ada@example.com within 1 hour. Then confirm ada.new@example.com from the link we send there. Until then you keep using ada@example.com.",
    );
  });

  it("refuses the address the account already uses", async () => {
    render(<ChangeEmailForm currentEmail="ada@example.com" />);

    await submit("ADA@example.com");

    expect(changeEmail).not.toHaveBeenCalled();
    expect(screen.getByText("This is already your email address.")).toBeTruthy();
  });

  it("asks for a valid address", async () => {
    render(<ChangeEmailForm currentEmail="ada@example.com" />);

    await submit("not an address");

    expect(changeEmail).not.toHaveBeenCalled();
    expect(screen.getByText("Enter an email address, like name@example.com.")).toBeTruthy();
  });

  it("says when too many changes were asked for", async () => {
    changeEmail.mockResolvedValue({
      data: null,
      error: { status: 429, code: "RATE_LIMITED", statusText: "Too Many Requests" },
    });
    render(<ChangeEmailForm currentEmail="ada@example.com" />);

    await submit("ada.new@example.com");

    expect(screen.getByRole("status").textContent).toContain("Too many attempts.");
  });
});
