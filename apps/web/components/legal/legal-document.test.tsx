import { parseLegalEnv } from "@cohory/config/legal";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegalDocument, lastUpdatedLine, legalTextsUpdatedAt } from "./legal-document";

describe("lastUpdatedLine", () => {
  it("names the day the operator set in LEGAL_UPDATED_AT", () => {
    expect(lastUpdatedLine(parseLegalEnv({ LEGAL_UPDATED_AT: "2026-11-02" }))).toBe(
      "Last updated 2 November 2026",
    );
  });

  it("falls back to the date the bundled texts were last changed", () => {
    expect(legalTextsUpdatedAt).toBe("2026-10-23");
    expect(lastUpdatedLine(parseLegalEnv({}))).toBe("Last updated 23 October 2026");
  });
});

describe("LegalDocument", () => {
  it("shows the title and the last updated date without a draft notice or version", () => {
    render(
      <LegalDocument title="Terms of Service">
        <p>Body</p>
      </LegalDocument>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeTruthy();
    expect(screen.getByText(/^Last updated /)).toBeTruthy();
    expect(screen.queryByText(/Draft for legal review/)).toBeNull();
    expect(screen.queryByText(/^Version /)).toBeNull();
  });
});
