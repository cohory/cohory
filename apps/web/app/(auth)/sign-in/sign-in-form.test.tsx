import { authClient } from "@cohory/auth/client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "./sign-in-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@cohory/auth/client", () => ({
  authClient: {
    signIn: { email: vi.fn(), magicLink: vi.fn() },
    sendVerificationEmail: vi.fn(),
  },
}));

const signInEmail = vi.mocked(authClient.signIn.email);
const magicLink = vi.mocked(authClient.signIn.magicLink);
const sendVerificationEmail = vi.mocked(authClient.sendVerificationEmail);

afterEach(() => {
  vi.clearAllMocks();
});

function typeEmail(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value } });
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("SignInForm", () => {
  it("emails a sign in link to the typed address and says how long it works", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    render(<SignInForm redirectTo="/c/design" magicLink />);
    typeEmail("ada@example.com");

    await click("Email me a sign in link");

    expect(magicLink).toHaveBeenCalledWith({ email: "ada@example.com", callbackURL: "/c/design" });
    expect(screen.getByRole("status").textContent).toContain(
      "If ada@example.com has an account, we sent a sign in link. It works for 15 minutes.",
    );
  });

  it("asks for the email address before sending a sign in link", async () => {
    render(<SignInForm redirectTo="/" magicLink />);

    await click("Email me a sign in link");

    expect(magicLink).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your email address first.")).toBeTruthy();
  });

  it("does not offer a sign in link when this site cannot send email", () => {
    render(<SignInForm redirectTo="/" magicLink={false} />);

    expect(screen.queryByRole("button", { name: "Email me a sign in link" })).toBeNull();
  });

  it("tells an unconfirmed member to confirm first and sends a new link on request", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 403, code: "EMAIL_NOT_VERIFIED", statusText: "Forbidden" },
    });
    sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });
    render(<SignInForm redirectTo="/c/design" magicLink />);
    typeEmail("ada@example.com");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long passphrase" } });

    await click("Sign in");

    expect(screen.getByRole("alert").textContent).toContain("Confirm your email first.");
    await click("Send a new link");
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: "/c/design",
    });
    expect(screen.getByRole("status").textContent).toContain("It works for 1 hour.");
  });

  it("moves focus to the error and links the reset page after a wrong password", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD", statusText: "Unauthorized" },
    });
    render(<SignInForm redirectTo="/" magicLink={false} />);
    typeEmail("ada@example.com");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a wrong guess" } });

    await click("Sign in");

    const alert = screen.getByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(alert.textContent).toBe(
      "That email and password do not match. Try again or reset your password.",
    );
    expect(screen.getByRole("link", { name: "reset your password" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
  });
});
