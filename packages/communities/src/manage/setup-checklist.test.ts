import { describe, expect, it } from "vitest";

import {
  buildSetupChecklist,
  type SetupCounts,
  type SetupExternalFacts,
  type SetupStepKey,
} from "./setup-checklist";

const at = new Date("2026-10-20T10:00:00.000Z");

type CommunityFacts = Parameters<typeof buildSetupChecklist>[0];

const blank: CommunityFacts = {
  slug: "makers",
  description: null,
  appearance: {},
  setupChecklistHiddenAt: null,
  setupImportSkippedAt: null,
  aboutPreviewedAt: null,
  inviteLinkCopiedAt: null,
  testCheckoutSucceededAt: null,
};

const noCounts: SetupCounts = {
  galleryItems: 0,
  pinnedStaffPosts: 0,
  publishedCourses: 0,
  upcomingEvents: 0,
  members: 0,
};

const unpaidOwner: SetupExternalFacts = {
  importRan: false,
  payments: { planSaved: false, chargesEnabled: false, livemode: false, everPaid: false },
};

function doneOf(
  community: Partial<CommunityFacts> = {},
  counts: Partial<SetupCounts> = {},
  external: SetupExternalFacts = unpaidOwner,
): Partial<Record<SetupStepKey, boolean>> {
  const checklist = buildSetupChecklist(
    { ...blank, ...community },
    { ...noCounts, ...counts },
    external,
  );
  return Object.fromEntries(checklist.steps.map((step) => [step.key, step.done]));
}

describe("buildSetupChecklist", () => {
  it("lists all 10 steps in order for a paid community, none done at the start", () => {
    const checklist = buildSetupChecklist(blank, noCounts, unpaidOwner);
    expect(checklist.steps.map((step) => step.key)).toEqual([
      "import",
      "branding",
      "about",
      "price",
      "stripe",
      "welcome_post",
      "first_content",
      "preview",
      "share",
      "test_purchase",
    ]);
    expect(checklist.doneCount).toBe(0);
    expect(checklist.hidden).toBe(false);
  });

  it("hides the price, Stripe and test purchase steps in a free community", () => {
    const keys = Object.keys(doneOf({}, {}, { importRan: false, payments: null }));
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("stripe");
    expect(keys).not.toContain("test_purchase");
    expect(keys).toHaveLength(7);
  });

  it("hides the import step from people who cannot import", () => {
    expect(doneOf({}, {}, { ...unpaidOwner, importRan: null })).not.toHaveProperty("import");
  });

  it("ticks import when an import ran or the owner chose to start fresh", () => {
    expect(doneOf({}, {}, { ...unpaidOwner, importRan: true }).import).toBe(true);
    expect(doneOf({ setupImportSkippedAt: at }).import).toBe(true);
    expect(doneOf().import).toBe(false);
  });

  it("ticks branding only when both logo and cover are set", () => {
    expect(doneOf({ appearance: { logoKey: "communities/x/logo.png" } }).branding).toBe(false);
    expect(
      doneOf({ appearance: { logoKey: "communities/x/logo.png", coverKey: "communities/x/c.png" } })
        .branding,
    ).toBe(true);
  });

  it("ticks the About page when the description is over 80 characters and a gallery item exists", () => {
    const long = "x".repeat(81);
    expect(doneOf({ description: long }, { galleryItems: 1 }).about).toBe(true);
    expect(doneOf({ description: "x".repeat(80) }, { galleryItems: 1 }).about).toBe(false);
    expect(doneOf({ description: long }, { galleryItems: 0 }).about).toBe(false);
  });

  it("ticks price once a plan is saved, even before Stripe is ready", () => {
    const done = doneOf(
      {},
      {},
      {
        importRan: false,
        payments: { planSaved: true, chargesEnabled: false, livemode: false, everPaid: false },
      },
    );
    expect(done.price).toBe(true);
    expect(done.stripe).toBe(false);
  });

  it("ticks Stripe when charges are enabled", () => {
    const done = doneOf(
      {},
      {},
      {
        importRan: false,
        payments: { planSaved: true, chargesEnabled: true, livemode: false, everPaid: false },
      },
    );
    expect(done.stripe).toBe(true);
  });

  it("ticks the welcome post when staff pinned a post", () => {
    expect(doneOf({}, { pinnedStaffPosts: 1 }).welcome_post).toBe(true);
    expect(doneOf().welcome_post).toBe(false);
  });

  it("ticks first content for a published course or an upcoming event", () => {
    expect(doneOf({}, { publishedCourses: 1 }).first_content).toBe(true);
    expect(doneOf({}, { upcomingEvents: 1 }).first_content).toBe(true);
    expect(doneOf().first_content).toBe(false);
  });

  it("ticks the preview once the About page was opened as a visitor", () => {
    expect(doneOf({ aboutPreviewedAt: at }).preview).toBe(true);
  });

  it("ticks sharing when the link was copied or 5 members joined", () => {
    expect(doneOf({ inviteLinkCopiedAt: at }).share).toBe(true);
    expect(doneOf({}, { members: 5 }).share).toBe(true);
    expect(doneOf({}, { members: 4 }).share).toBe(false);
  });

  it("ticks the test purchase only after a purchase and a live, ready connection", () => {
    const facts = (livemode: boolean, everPaid: boolean): SetupExternalFacts => ({
      importRan: false,
      payments: { planSaved: true, chargesEnabled: true, livemode, everPaid },
    });
    expect(doneOf({}, {}, facts(false, true)).test_purchase).toBe(false);
    expect(doneOf({}, {}, facts(true, false)).test_purchase).toBe(false);
    expect(doneOf({}, {}, facts(true, true)).test_purchase).toBe(true);
    expect(doneOf({ testCheckoutSucceededAt: at }, {}, facts(true, false)).test_purchase).toBe(
      true,
    );
  });

  it("links each step to the page where the owner does it", () => {
    const checklist = buildSetupChecklist(blank, noCounts, unpaidOwner);
    const href = (key: SetupStepKey) => checklist.steps.find((step) => step.key === key)?.href;
    expect(href("import")).toBe("/c/makers/manage/migration");
    expect(href("stripe")).toBe("/c/makers/manage/payments?setup=connect");
    expect(href("preview")).toBe("/c/makers/about?preview=1");
  });

  it("counts done steps and reports when the owner hid the checklist", () => {
    const checklist = buildSetupChecklist(
      { ...blank, setupChecklistHiddenAt: at, aboutPreviewedAt: at },
      { ...noCounts, publishedCourses: 1 },
      unpaidOwner,
    );
    expect(checklist.doneCount).toBe(2);
    expect(checklist.hidden).toBe(true);
  });
});
