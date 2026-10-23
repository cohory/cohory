import { describe, expect, it } from "vitest";

import { manageEntry, manageSectionHref, manageSectionsFor } from "./sections";

describe("manageSectionsFor", () => {
  it("gives owners and admins every section in order, with Inbox after Overview", () => {
    const all = ["overview", "inbox", "people", "payments", "appearance", "settings", "migration"];
    expect(manageSectionsFor("owner")).toEqual(all);
    expect(manageSectionsFor("admin")).toEqual(all);
  });

  it("gives moderators Inbox first, then People", () => {
    expect(manageSectionsFor("moderator")).toEqual(["inbox", "people"]);
  });

  it("gives members and non members nothing", () => {
    expect(manageSectionsFor("member")).toEqual([]);
    expect(manageSectionsFor(null)).toEqual([]);
  });
});

describe("manageSectionHref", () => {
  it("puts Overview at the manage root", () => {
    expect(manageSectionHref("makers", "overview")).toBe("/c/makers/manage");
    expect(manageSectionHref("makers", "inbox")).toBe("/c/makers/manage/inbox");
    expect(manageSectionHref("makers", "migration")).toBe("/c/makers/manage/migration");
  });
});

describe("manageEntry", () => {
  it("sends a signed out visitor to sign in and back to the section they asked for", () => {
    expect(manageEntry("makers", "guest", null, "settings")).toEqual({
      kind: "sign_in",
      next: "/c/makers/manage/settings",
    });
    expect(manageEntry("makers", "guest", null)).toEqual({
      kind: "sign_in",
      next: "/c/makers/manage",
    });
  });

  it("keeps the query of the link a signed out owner opened, such as the requests link in an email", () => {
    expect(manageEntry("makers", "guest", null, "people", { tab: "requests" })).toEqual({
      kind: "sign_in",
      next: "/c/makers/manage/people?tab=requests",
    });
    expect(
      manageEntry("makers", "guest", null, "inbox", { tab: "reports", reports: ["closed"] }),
    ).toEqual({ kind: "sign_in", next: "/c/makers/manage/inbox?tab=reports&reports=closed" });
  });

  it("hides Manage from members and from signed in non members", () => {
    expect(manageEntry("makers", "user", "member")).toEqual({ kind: "not_found" });
    expect(manageEntry("makers", "user", null, "people")).toEqual({ kind: "not_found" });
  });

  it("opens the shared layout for a moderator without redirecting again", () => {
    expect(manageEntry("makers", "user", "moderator")).toEqual({
      kind: "open",
      sections: ["inbox", "people"],
    });
  });

  it("lands a moderator on Inbox from any section they cannot open", () => {
    for (const section of ["overview", "payments", "settings"] as const) {
      expect(manageEntry("makers", "user", "moderator", section)).toEqual({
        kind: "redirect",
        href: "/c/makers/manage/inbox",
      });
    }
    expect(manageEntry("makers", "user", "moderator", "people").kind).toBe("open");
    expect(manageEntry("makers", "user", "moderator", "inbox").kind).toBe("open");
  });

  it("opens every section for owners and admins", () => {
    expect(manageEntry("makers", "user", "admin", "payments").kind).toBe("open");
    expect(manageEntry("makers", "user", "admin", "inbox").kind).toBe("open");
    expect(manageEntry("makers", "user", "owner").kind).toBe("open");
  });
});
