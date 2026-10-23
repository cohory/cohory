import type { Actor } from "@cohory/authz";
import { describe, expect, it } from "vitest";

import { settingsSectionHref, settingsSectionsFor } from "./settings-sections";

const actor: Actor = {
  kind: "user",
  userId: "0199e7a0-0000-7000-8000-000000000001",
  platformAdmin: false,
};

describe("settingsSectionsFor", () => {
  it("gives the owner every settings section with Danger zone last", () => {
    expect(settingsSectionsFor(actor, "owner")).toEqual([
      "general",
      "joining",
      "categories",
      "points",
      "agents",
      "webhooks",
      "audit-log",
      "danger-zone",
    ]);
  });

  it("gives admins everything except Danger zone", () => {
    expect(settingsSectionsFor(actor, "admin")).not.toContain("danger-zone");
    expect(settingsSectionsFor(actor, "admin")).toContain("general");
  });

  it("gives moderators and members no settings", () => {
    expect(settingsSectionsFor(actor, "moderator")).toEqual([]);
    expect(settingsSectionsFor(actor, "member")).toEqual([]);
  });
});

describe("settingsSectionHref", () => {
  it("puts General at the settings root", () => {
    expect(settingsSectionHref("lab", "general")).toBe("/c/lab/manage/settings");
    expect(settingsSectionHref("lab", "danger-zone")).toBe("/c/lab/manage/settings/danger-zone");
  });
});
