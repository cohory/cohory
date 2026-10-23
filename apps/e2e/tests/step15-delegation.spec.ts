import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { stripeCalls } from "../support/stripe";
import { addLesson, createCourse, publishCourse } from "../pages/classroom";
import { createCommunity, expectNoHorizontalScroll, joinCommunity } from "../pages/community";
import { settle } from "../pages/feed";
import { connectStripeAndSavePlan } from "../pages/manage";

test("step 15 delegation: a member lends course access to an agent, revokes it, and answers a purchase request", async ({
  actor,
  request,
}) => {
  const owner = await actor("Olive", { desktop: true });
  const member = await actor("Mia", { desktop: true });
  const slug = await createCommunity(owner.page, `Agent courses ${uniqueSuffix()}`, "public");
  await joinCommunity(member.page, slug);
  const [[communityId = ""] = []] = await query(
    `select id from communities where slug = '${slug}'`,
  );
  let courseSlug = "";
  let lessonSlug = "";
  let token = "";
  let account = "";

  await test.step("the creator publishes a course and allows agent access", async () => {
    const page = owner.page;
    courseSlug = await createCourse(page, slug, "Agents 101");
    lessonSlug = await addLesson(page, slug, courseSlug, "Module 1", {
      title: "Welcome",
      body: "Read me first.",
    });
    await publishCourse(page, slug, courseSlug);
    await settle(page);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const card = page.getByRole("form", { name: "Agent access settings" });
    await expect(
      card.getByRole("radio", { name: /Personal use by the buyer's agents only/ }),
    ).toBeChecked();
    await card.getByRole("switch", { name: "Allow agent access" }).click();
    await expect(page.getByText("Agent access is on.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Save license terms" })).toBeEnabled();
    await expectAccessible(page, "course page with agent access settings");
    account = await connectStripeAndSavePlan(page, slug);
  });

  await test.step("the member creates an agent in Account, Agents and issues a token", async () => {
    const page = member.page;
    await page.goto(`/account/agents?community=${slug}`);
    await settle(page);
    await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /^Write posts/ })).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Study buddy");
    await page.getByRole("checkbox", { name: /^Propose changes/ }).check();
    await page.getByRole("button", { name: "Create agent" }).click();
    token = (await page.getByTestId("new-token").innerText()).trim();
    expect(token).toMatch(/^cohory_/);
    await page.getByRole("button", { name: "I stored it" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Study buddy" }).first(),
    ).toBeVisible();
    await expectAccessible(page, "account agents");
  });

  const coursePath = () => `/api/v1/communities/${slug}/courses/${courseSlug}`;
  const auth = () => ({ authorization: `Bearer ${token}` });

  await test.step("without a delegation the agent cannot read the course", async () => {
    const response = await request.get(coursePath(), { headers: auth() });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "delegation_required", details: { reason: "no_delegation" } },
    });
  });

  await test.step("the member gives the agent access after reading the terms", async () => {
    const page = member.page;
    await page.goto(`/c/${slug}/classroom/${courseSlug}`);
    await settle(page);
    await expect(page.getByText("Personal use by the buyer's agents only").first()).toBeVisible();
    await page.getByRole("button", { name: "Give my agent access" }).click();
    const dialog = page.getByRole("dialog", { name: "Give my agent access" });
    await expect(dialog.getByRole("radio", { name: "Study buddy" })).toBeChecked();
    await expect(dialog.getByText("Personal use by the buyer's agents only")).toBeVisible();
    await expectAccessible(page, "delegate dialog");
    await dialog.getByRole("button", { name: "Agree and give access" }).click();
    await expect(page.getByText("Your agent can read this course for 30 days.")).toBeVisible();
    const row = page.getByRole("region", { name: "Your agents with access" });
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expectAccessible(page, "course page with a delegation");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, "course page with a delegation on a phone");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("the agent reads the course and a lesson with its token", async () => {
    const course = await request.get(coursePath(), { headers: auth() });
    expect(course.status()).toBe(200);
    expect(await course.json()).toMatchObject({ title: "Agents 101" });
    const lesson = await request.get(`${coursePath()}/lessons/${lessonSlug}`, { headers: auth() });
    expect(lesson.status()).toBe(200);
  });

  await test.step("revoking stops the agent on its next request", async () => {
    const page = member.page;
    await page.getByRole("button", { name: "Revoke access for Study buddy" }).click();
    await expect(page.getByText("Access revoked.")).toBeVisible();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    const response = await request.get(coursePath(), { headers: auth() });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "delegation_required", details: { reason: "revoked" } },
    });
  });

  await test.step("an agent purchase becomes a request that charges nothing", async () => {
    const before = (await stripeCalls(account)).length;
    const response = await request.post(`/api/v1/communities/${communityId}/payments/checkout`, {
      headers: auth(),
      data: { interval: "month" },
    });
    expect(response.status()).toBe(202);
    const pending = (await response.json()) as { status: string; approvalId: string };
    expect(pending.status).toBe("pending_approval");
    expect((await stripeCalls(account)).length).toBe(before);

    await owner.page.goto(`/c/${slug}/manage/approvals`);
    await settle(owner.page);
    await expect(owner.page.getByText(/buy a monthly membership/)).toHaveCount(0);

    const page = member.page;
    await page.goto(`/account/agents?community=${slug}`);
    await settle(page);
    const item = page
      .getByRole("listitem")
      .filter({ hasText: /Asks you to buy a monthly membership/ });
    await expect(item).toBeVisible();
    await expect(item.getByText("Waiting for you")).toBeVisible();
    await expectAccessible(page, "account agents with a purchase request");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await item.getByRole("button", { name: "Approve and go to checkout" }).click();
    await expect(
      page.getByText("You already have access, so there is nothing to buy. Nothing was charged."),
    ).toBeVisible();
    const calls = await stripeCalls(account);
    expect(
      calls.filter((call) => /charges|payment_intents|invoices\/.*\/pay/.test(call.path)),
    ).toEqual([]);
    const actions = await query(
      `select a.action from audit_log a where a.community_id = '${communityId}' and a.action in ('course.agent_access_updated', 'delegation.created', 'delegation.revoked', 'purchase.proposed') order by a.created_at`,
    );
    expect(actions.map((row) => row[0])).toEqual([
      "course.agent_access_updated",
      "delegation.created",
      "delegation.revoked",
      "purchase.proposed",
    ]);
  });
});
