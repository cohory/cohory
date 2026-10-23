import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Page, TestInfo } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { cloudBetaUrl } from "../support/cloud-beta";
import { query } from "../support/db";
import { expect, test, type ActorOptions } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { communityEditionUrl } from "../support/stripe";

const views = [
  { name: "desktop", options: { desktop: true } },
  { name: "phone", options: { mobile: true } },
] as const satisfies readonly { name: string; options: ActorOptions }[];

const createHref = "/sign-up?next=%2Fcommunities%2Fnew";
// Mirrors CONTACT_EMAIL in scripts/e2e-host.sh and apps/e2e/compose.e2e.yml.
const contactEmail = "contact@e2e.example.test";
const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
const poll = { timeout: 60_000, intervals: [1_000, 2_000] };

const featureTitles = [
  "Feed",
  "Courses",
  "Events",
  "Memberships",
  "AI agents",
  "Import/Export",
  "Leaderboard",
  "Notifications",
  "Landing page",
];

async function expectNoSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await saveScreenshot(page, name);
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  if ((page.viewportSize()?.width ?? 1280) > 390) {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await page.screenshot({ path: join(screenshotDirectory, `${name}.png`), fullPage: true });
}

async function expectEarlyAccessCtas(page: Page): Promise<void> {
  await expect(page.getByRole("link", { name: "Create your community" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Get started" })).toHaveCount(0);
  await expect(page.getByText("No credit card required.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request early access" }).last()).toHaveAttribute(
    "href",
    "/early-access",
  );
  await expect(page.getByRole("link", { name: "Self-host now" }).last()).toHaveAttribute(
    "href",
    "/open-source",
  );
}

interface QueuedEarlyAccess {
  readonly platform: string;
  readonly members: string;
  readonly note: string | null;
  readonly account: { readonly id: string; readonly email: string } | null;
}

async function queuedEarlyAccess(email: string): Promise<QueuedEarlyAccess> {
  let found: QueuedEarlyAccess | undefined;
  await expect
    .poll(async () => {
      const [row] = await query(
        `select data->'data' from pgboss.job where name = 'email.send' and data->>'template' = 'early-access-request' and data->>'to' = '${contactEmail}' and data->'data'->>'email' = '${email}'`,
      );
      found = row?.[0] ? (JSON.parse(row[0]) as QueuedEarlyAccess) : undefined;
      return found !== undefined;
    }, poll)
    .toBe(true);
  if (!found) throw new Error("no queued early access request");
  return found;
}

for (const view of views) {
  test(`the Cloud landing shows a signed out creator what they get and how to start on ${view.name}`, async ({
    actor,
  }, testInfo) => {
    const { page } = await actor("Visitor", { signedIn: false, ...view.options });
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Your community, courses, and events in one place",
      }),
    ).toBeVisible();
    const create = page.getByRole("link", { name: "Create your community" });
    await expect(create.first()).toHaveAttribute("href", createHref);
    await expect(page.getByText("No credit card required.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Request early access" })).toHaveCount(0);
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    await expect(main.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "/open-source",
    );
    for (const heading of [
      "What you get",
      "How it works",
      "Pricing",
      "Open source, so you can leave",
      "Questions",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    const features = page.getByRole("region", { name: "What you get" });
    await expect(features.getByRole("heading", { level: 3 })).toHaveText(featureTitles);
    await testInfo.attach(`what-you-get-${view.name}`, {
      body: await features.screenshot(),
      contentType: "image/png",
    });

    await expect(
      page.getByText(
        "Free to start. 2% of each payment you receive. Stripe processing fees are separate.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/Learn more about/)).toHaveCount(0);

    await page.getByText("Do I need a credit card to start?").click();
    await expect(page.getByText(/You connect Stripe only when you want to charge/)).toBeVisible();

    await expectNoSideScroll(page);
    await expectAccessible(page, `Cloud landing on ${view.name}`);
    await attachScreenshot(page, testInfo, `landing-${view.name}`);
  });

  test(`Cloud pricing reads the fee from the payments config and compares self-hosting on ${view.name}`, async ({
    actor,
  }, testInfo) => {
    const { page } = await actor("Pricing", { signedIn: false, ...view.options });
    await page.goto("/pricing");

    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    await expect(page).toHaveTitle(/^Pricing · /);
    await expect(page.getByText("then 2% of each payment you receive")).toBeVisible();
    await expect(
      page
        .getByText(
          "Platform fee: 2% of each successful payment. Stripe processing fees are separate.",
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your community" }).last()).toHaveAttribute(
      "href",
      createHref,
    );
    await expect(page.getByRole("link", { name: "Request early access" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Fair use limits" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Members" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Community Edition" })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "No platform fee. Stripe processing fees are separate." }),
    ).toBeVisible();

    await expectNoSideScroll(page);
    await expectAccessible(page, `Cloud pricing on ${view.name}`);
    await attachScreenshot(page, testInfo, `pricing-${view.name}`);
  });

  test(`the Cloud open source page explains the Community Edition and the license on ${view.name}`, async ({
    actor,
  }, testInfo) => {
    const { page } = await actor("Opensource", { signedIn: false, ...view.options });
    await page.goto("/open-source");

    await expect(page.getByRole("heading", { level: 1, name: "Open source" })).toBeVisible();
    await expect(page).toHaveTitle(/^Open source · /);
    await expect(
      page.getByRole("heading", { level: 2, name: "The Community Edition" }),
    ).toBeVisible();
    await expect(page.getByText(/GNU Affero General Public License, version 3/)).toBeVisible();
    await expect(page.getByText(/agent runner are MIT licensed/)).toBeVisible();
    await expect(page.getByText("docs/self-hosting.md", { exact: true })).toBeVisible();

    await expectNoSideScroll(page);
    await expectAccessible(page, `Cloud open source on ${view.name}`);
    await attachScreenshot(page, testInfo, `open-source-${view.name}`);
  });

  test(`while only operators create communities, the Cloud landing and pricing ask for early access on ${view.name}`, async ({
    actor,
  }, testInfo) => {
    const { page } = await actor("Prospect", { signedIn: false, ...view.options });

    await page.goto(`${cloudBetaUrl}/`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Your community, courses, and events in one place",
      }),
    ).toBeVisible();
    await expectEarlyAccessCtas(page);
    await expect(
      page.getByRole("heading", { level: 2, name: "Start your community", exact: true }),
    ).toBeVisible();
    if (view.name === "desktop") {
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Request early access" }),
      ).toBeVisible();
    }
    await expectNoSideScroll(page);
    await expectAccessible(page, `Cloud beta landing on ${view.name}`);
    await attachScreenshot(page, testInfo, `beta-landing-${view.name}`);

    await page.goto(`${cloudBetaUrl}/pricing`);
    await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    await expectEarlyAccessCtas(page);
    await expectNoSideScroll(page);
    await expectAccessible(page, `Cloud beta pricing on ${view.name}`);
    await attachScreenshot(page, testInfo, `beta-pricing-${view.name}`);

    await page.goto(`${cloudBetaUrl}/open-source`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Or ask for early access to Cloud" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Self-host now" })).toHaveCount(0);
  });

  test(`a creator requests early access and the request is queued for the operator on ${view.name}`, async ({
    actor,
  }, testInfo) => {
    const { page } = await actor("Prospect", { signedIn: false, ...view.options });
    await page.goto(`${cloudBetaUrl}/`);
    await page.getByRole("link", { name: "Request early access" }).first().click();
    await expect(page).toHaveURL(`${cloudBetaUrl}/early-access`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Request early access" }),
    ).toBeVisible();

    const email = `prospect-${uniqueSuffix()}@example.test`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Choose the platform you use today.")).toBeVisible();
    await page.getByLabel("Platform you use today").selectOption("Skool");
    await expect(page.getByText("Choose the platform you use today.")).toHaveCount(0);
    await page.getByLabel("Paying members today").selectOption("51 to 500");
    await page.getByLabel("Anything else (optional)").fill("A yoga group, mostly yearly plans.");
    await expectNoSideScroll(page);
    await expectAccessible(page, `Early access form on ${view.name}`);
    await attachScreenshot(page, testInfo, `early-access-form-${view.name}`);
    // The form drops a request sent within 3 seconds of being shown.
    await page.waitForTimeout(3_500);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Thanks. We read every request and reply by email")).toBeVisible();
    await expectAccessible(page, `Early access confirmation on ${view.name}`);
    await attachScreenshot(page, testInfo, `early-access-sent-${view.name}`);

    expect(await queuedEarlyAccess(email)).toEqual(
      expect.objectContaining({
        platform: "Skool",
        members: "51 to 500",
        note: "A yoga group, mostly yearly plans.",
        account: null,
      }),
    );
  });

  test(`a signed in member who may not create a community finds early access instead on ${view.name}`, async ({
    actor,
  }, testInfo) => {
    const { page, person } = await actor("Member", view.options);
    await page.goto(`${cloudBetaUrl}/`);

    await expect(page.getByRole("heading", { level: 1, name: "My communities" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Create (a|your first) community/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Request early access" })).toHaveAttribute(
      "href",
      "/early-access",
    );
    await expectAccessible(page, `Cloud beta home on ${view.name}`);
    await attachScreenshot(page, testInfo, `beta-member-home-${view.name}`);

    await page.getByRole("button", { name: `Open account menu for ${person.name}` }).click();
    await expect(page.getByRole("menuitem", { name: "Create a community" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Request early access" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto(`${cloudBetaUrl}/communities/new`);
    await expect(
      page.getByText("Only the people who run this server can create communities."),
    ).toBeVisible();
    await expect(page.getByLabel("URL", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Request early access" })).toBeVisible();

    await page.goto(`${cloudBetaUrl}/early-access`);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(person.email);
  });
}

test("a signed in person on Cloud still gets their own home instead of the landing", async ({
  actor,
}) => {
  const { page } = await actor("Member");
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "My communities" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create your first community" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request early access" })).toHaveCount(0);
});

test("the Cloud sitemap lists the pricing and open source pages", async ({ actor, baseURL }) => {
  const { page } = await actor("Crawler", { signedIn: false });
  const sitemap = await (await page.request.get("/sitemap.xml")).text();

  expect(sitemap).toContain(`${baseURL}/pricing`);
  expect(sitemap).toContain(`${baseURL}/open-source`);
});

test("the Community Edition keeps the neutral home and has no marketing pages", async ({
  actor,
}) => {
  const { page } = await actor("Operator", { signedIn: false, mobile: true });
  await page.goto(`${communityEditionUrl}/`);

  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Cohory" })).toBeVisible();
  await expect(page.getByText(/platform fee/i)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create your community" })).toHaveAttribute(
    "href",
    createHref,
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(1);
  await expectNoSideScroll(page);
  await expectAccessible(page, "Community Edition home");

  for (const path of ["/pricing", "/open-source", "/early-access"]) {
    const response = await page.goto(`${communityEditionUrl}${path}`);
    expect(response?.status(), path).toBe(404);
  }
  const sitemap = await (await page.request.get(`${communityEditionUrl}/sitemap.xml`)).text();
  expect(sitemap).not.toContain("/pricing");
  expect(sitemap).not.toContain("/open-source");
});
