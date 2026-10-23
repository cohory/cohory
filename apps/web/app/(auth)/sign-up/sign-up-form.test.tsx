import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConsentLine } from "./sign-up-form";

const noLinks = { terms: null, privacy: null, minimumAge: 16, termsVersion: null };

describe("ConsentLine", () => {
  it("asks for agreement to the Terms and Privacy Policy and states the minimum age", () => {
    render(
      <ConsentLine
        consent={{ ...noLinks, terms: "/terms", privacy: "/privacy", termsVersion: "1" }}
      />,
    );

    expect(screen.getByText(/By creating an account you agree to the/).textContent).toBe(
      "By creating an account you agree to the Terms and Privacy Policy. You must be 16 or older.",
    );
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
      "/privacy",
    );
  });

  it("states only the minimum age when the server has no Terms or Privacy Policy", () => {
    render(<ConsentLine consent={noLinks} />);

    expect(screen.getByText("You must be 16 or older to create an account.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links a Privacy Policy without asking for agreement when only that is set", () => {
    render(<ConsentLine consent={{ ...noLinks, privacy: "https://acme.example.com/privacy" }} />);

    expect(screen.queryByText(/agree/)).toBeNull();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeTruthy();
  });
});
