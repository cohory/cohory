import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { settle } from "../pages/feed";
import { payCheckout, stubStripePages } from "../pages/reviews";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3310";
const rule = "Members who have paid for at least 30 days can leave a review.";
const trustLine = "Every review is from a member who has paid for at least 30 days.";
const reviewText = "Weekly calls that actually help. The owner answers every question.";

test("step 17: reviews from paying members, owner replies, reports, and hiding", async ({
  actor,
}, testInfo) => {
  test.slow();
  const owner = await actor("Rhea", { desktop: true });
  const subscriber = await actor("Sami", { desktop: true });
  const newcomer = await actor("Nell", { mobile: true });
  await Promise.all([owner.context, subscriber.context, newcomer.context].map(stubStripePages));
  const slug = await createCommunity(owner.page, `Reviews ${uniqueSuffix()}`, "public");

  const account = await test.step("the owner sells a monthly membership", async () => {
    await owner.page.goto(`/c/${slug}/manage/payments`);
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Connect your Stripe account" }).click();
    await expect(owner.page).toHaveURL(/^https:\/\/connect\.stripe\.test\/onboard\/acct_/);
    const connected = new URL(owner.page.url()).pathname.split("/").pop() ?? "";
    await owner.page.goto(`/c/${slug}/manage/payments?stripe=return`);
    await expect(owner.page.getByText("Connected", { exact: true })).toBeVisible();
    await settle(owner.page);
    await owner.page.getByLabel("Currency").selectOption("usd");
    await owner.page.getByLabel("Monthly price").fill("29");
    await owner.page.getByRole("button", { name: "Put on sale" }).click();
    await expect(owner.page.getByText(/\$29\.00 per month/)).toBeVisible();
    return connected;
  });

  await test.step("the owner turns reviews on in Manage, Settings", async () => {
    await owner.page.goto(`/c/${slug}/manage/settings`);
    await settle(owner.page);
    await expect(owner.page.getByText(/Members who have paid for at least 30 days/)).toBeVisible();
    await owner.page.getByRole("switch", { name: "Show reviews on the About page" }).click();
    await owner.page.getByRole("button", { name: "Save reviews setting" }).click();
    await expect(owner.page.getByText("Reviews are on.")).toBeVisible();
  });

  await test.step("visitors see no empty reviews box; the owner preview explains why", async () => {
    await newcomer.page.goto(`/c/${slug}/about`);
    await settle(newcomer.page);
    await expect(newcomer.page.getByRole("heading", { name: "Reviews", exact: true })).toHaveCount(
      0,
    );
    await owner.page.goto(`/c/${slug}/about?preview=1`);
    const section = owner.page.getByRole("region", { name: "Reviews" });
    await expect(
      section.getByText("No reviews yet. Visitors see this section once there is a review."),
    ).toBeVisible();
    await expect(section.getByText(trustLine)).toBeVisible();
  });

  await test.step("two people subscribe; one has paid for 40 days", async () => {
    for (const buyer of [subscriber, newcomer]) {
      await buyer.page.goto(`/c/${slug}/membership`);
      await settle(buyer.page);
      await buyer.page.getByRole("button", { name: "Join for $29.00/month" }).click();
      await expect(buyer.page).toHaveURL(/^https:\/\/checkout\.stripe\.test\/pay\/cs_/);
      await payCheckout(account);
    }
    const [subscription] = await query(
      `select s.id from subscriptions s join users u on u.id = s.user_id where u.email = '${subscriber.person.email}'`,
    );
    expect(subscription?.[0], "the subscriber's subscription").toBeTruthy();
    await query(
      `update subscriptions set created_at = now() - interval '40 days' where id = '${subscription?.[0] ?? ""}';
       update payments set occurred_at = now() - interval '40 days' where subscription_id = '${subscription?.[0] ?? ""}'`,
    );
  });

  await test.step("a member who paid today sees the rule instead of the form", async () => {
    await newcomer.page.goto(`/c/${slug}/about`);
    const section = newcomer.page.getByRole("region", { name: "Reviews" });
    await expect(section.getByText(new RegExp(`^${rule} You can leave one from`))).toBeVisible();
    await expect(section.getByRole("form", { name: "Write a review" })).toHaveCount(0);
    await expectNoHorizontalScroll(newcomer.page);
    await expectAccessible(newcomer.page, "about with reviews (390 wide)");
  });

  await test.step("the 40 day subscriber writes a review", async () => {
    await subscriber.page.goto(`/c/${slug}/about`);
    await settle(subscriber.page);
    const form = subscriber.page.getByRole("form", { name: "Write a review" });
    await form.locator("label").filter({ hasText: "4 stars" }).click();
    await form.getByLabel("Your review").fill(reviewText);
    await form.getByRole("button", { name: "Post review" }).click();
    await expect(subscriber.page.getByText("Thanks for your review.")).toBeVisible();
    const review = subscriber.page.getByRole("listitem", {
      name: `Review by ${subscriber.person.name}`,
    });
    await expect(review.getByText(reviewText)).toBeVisible();
    await expect(review.getByText("Paying member for 1 month")).toBeVisible();
    await expect(subscriber.page.getByText("You reviewed this community.")).toBeVisible();
    await expectAccessible(subscriber.page, "about with a review");
  });

  await test.step("the owner replies in public", async () => {
    await owner.page.goto(`/c/${slug}/about`);
    await settle(owner.page);
    const review = owner.page.getByRole("listitem", {
      name: `Review by ${subscriber.person.name}`,
    });
    await review.getByRole("button", { name: "Reply" }).click();
    await review.getByLabel("Your public reply").fill("Thank you, see you on Thursday.");
    await review.getByRole("button", { name: "Save reply" }).click();
    await expect(review.getByText("Reply from the owner")).toBeVisible();
    await expect(review.getByText("Thank you, see you on Thursday.")).toBeVisible();
    await owner.page.screenshot({
      path: testInfo.outputPath("reviews-desktop.png"),
      fullPage: true,
    });
  });

  await test.step("another member reports the review", async () => {
    await newcomer.page.goto(`/c/${slug}/about`);
    await settle(newcomer.page);
    const review = newcomer.page.getByRole("listitem", {
      name: `Review by ${subscriber.person.name}`,
    });
    await expect(review.getByText("Thank you, see you on Thursday.")).toBeVisible();
    await newcomer.page.screenshot({
      path: testInfo.outputPath("reviews-390.png"),
      fullPage: true,
    });
    await review.getByRole("button", { name: "Report" }).click();
    const dialog = newcomer.page.getByRole("dialog", { name: "Report this review" });
    await dialog.getByText("Spam or advertising").click();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(newcomer.page.getByText("Thanks. The moderators will take a look.")).toBeVisible();
  });

  await test.step("the owner hides the reported review with a reason", async () => {
    await owner.page.goto(`/c/${slug}/manage/people?tab=reports`);
    await settle(owner.page);
    const item = owner.page.getByRole("listitem", {
      name: `Reported review by ${subscriber.person.name}`,
    });
    await expect(item).toBeVisible();
    await expectAccessible(owner.page, "manage reports with a reported review");
    await item.getByLabel("Reason to hide").selectOption("personal_data");
    await item.getByRole("button", { name: "Hide review" }).click();
    await expect(owner.page.getByText("Review hidden.")).toBeVisible();

    await owner.page.goto(`/c/${slug}/about`);
    const section = owner.page.getByRole("region", { name: "Reviews" });
    await expect(
      section.getByText("1 review hidden by the owner for: personal data"),
    ).toBeVisible();
    await expect(section.getByText(reviewText)).toHaveCount(0);
    const [entry] = await query(
      `select a.action from audit_log a join communities c on c.id = a.community_id where c.slug = '${slug}' and a.action = 'review.hidden'`,
    );
    expect(entry?.[0]).toBe("review.hidden");
  });

  await test.step("a personal API token can read reviews but never write one", async () => {
    const [community] = await query(`select id from communities where slug = '${slug}'`);
    const created = await subscriber.context.request.post("/api/v1/me/api-tokens", {
      headers: { origin: baseUrl },
      data: {
        communityId: community?.[0] ?? "",
        name: "Reviews reader",
        scopes: ["community:read"],
        expiresInDays: 7,
      },
    });
    expect(created.status()).toBe(201);
    const { token } = (await created.json()) as { token: string };
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const read = await fetch(`${baseUrl}/api/v1/communities/${slug}/reviews/summary`, { headers });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ status: "enabled", count: 0 });
    const write = await fetch(`${baseUrl}/api/v1/communities/${slug}/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rating: 5, body: reviewText }),
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: { code: "token_not_allowed" } });
  });
});
