import { approvalCategories } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import { approvalRisk } from "./risk";

describe("approvalRisk", () => {
  it.each([
    ["money", "Money"],
    ["payment_connection", "Money"],
    ["role", "People"],
    ["removal", "People"],
    ["deletion", "Delete"],
  ])("asks for a confirm on %s requests", (category, label) => {
    expect(approvalRisk(category)).toEqual({ label, serious: true });
  });

  it.each([
    ["publishing", "Publish"],
    ["settings", "Settings"],
    ["data_export", "Data"],
    ["data_import", "Data"],
    ["purchase", "Money"],
  ])("keeps %s requests to one click", (category, label) => {
    expect(approvalRisk(category)).toEqual({ label, serious: false });
  });

  it("labels every known category", () => {
    for (const category of approvalCategories) {
      expect(approvalRisk(category).label).not.toBe("Other");
    }
  });

  it("treats an unknown category as serious", () => {
    expect(approvalRisk("something_new")).toEqual({ label: "Other", serious: true });
  });
});
