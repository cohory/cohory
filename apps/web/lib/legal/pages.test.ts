import { parseLegalEnv } from "@cohory/config/legal";
import { describe, expect, it } from "vitest";

import { legalPageView } from "./pages";

describe("legalPageView", () => {
  it("sends people to the operator's own page when its URL is set, on any edition", () => {
    const legal = parseLegalEnv({ LEGAL_PRIVACY_URL: "https://acme.example.com/privacy" });
    expect(legalPageView("privacy", legal, "community")).toEqual({
      kind: "operator",
      url: "https://acme.example.com/privacy",
    });
    expect(legalPageView("privacy", legal, "cloud").kind).toBe("operator");
  });

  it("shows the Cloud draft on Cloud and the neutral template on self-hosted servers", () => {
    const legal = parseLegalEnv({});
    expect(legalPageView("terms", legal, "cloud")).toEqual({ kind: "cloud_draft" });
    expect(legalPageView("terms", legal, "community")).toEqual({ kind: "template" });
  });
});
