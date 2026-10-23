import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, requestToJoin, expectSections, sectionLinks } from "../pages/community";
import { bell, settle } from "../pages/feed";
import { connectStripeAndSavePlan, createInviteLink, saveJoinSettings } from "../pages/manage";

const question = "What brings you here?";

test("step 10 joining: approval with answers, a decline with a note, and the second request", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const name = `Guild ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "private");
  await saveJoinSettings(owner.page, slug, { mode: "Approval", questions: [question] });

  const requester = await actor("Rae");
  const request = owner.page.getByRole("listitem", {
    name: `Request from ${requester.person.name}`,
  });

  await test.step("the requester answers the join question", async () => {
    await requester.page.goto(`/c/${slug}`);
    await settle(requester.page);
    await requestToJoin(requester.page, { [`${question} (optional)`]: "Wheel throwing" });
    await expect(requester.page.getByText("Request pending")).toBeVisible({ timeout: 30_000 });
    await expectAccessible(requester.page, "about (request pending)");
  });

  await test.step("staff see the answer and decline with a note", async () => {
    await owner.page.goto(`/c/${slug}/manage/people?tab=requests`);
    await settle(owner.page);
    await expect(request.getByText(question)).toBeVisible();
    await expect(request.getByText("Wheel throwing")).toBeVisible();
    await request.getByLabel("Note to the person (optional)").fill("Ask again after the open day.");
    await request.getByRole("button", { name: "Decline" }).click();
    await expect(request).toHaveCount(0, { timeout: 30_000 });
  });

  await test.step("the requester sees the note and can request again", async () => {
    await requester.page.goto(`/c/${slug}`);
    await settle(requester.page);
    await expect(requester.page.getByText("Your request was not approved.")).toBeVisible();
    await expect(requester.page.getByText("Ask again after the open day.")).toBeVisible();
    await expectAccessible(requester.page, "about (request declined)");
    await requestToJoin(
      requester.page,
      { [`${question} (optional)`]: "Still keen, open day done" },
      "Request again",
    );
    await expect(requester.page.getByText("Request pending")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("approval lets the member in and tells them in the app", async () => {
    await owner.page.goto(`/c/${slug}/manage/people?tab=requests`);
    await settle(owner.page);
    await expect(request.getByText("Still keen, open day done")).toBeVisible();
    await request.getByRole("button", { name: `Approve ${requester.person.name}` }).click();
    await expect(request).toHaveCount(0, { timeout: 30_000 });

    await requester.page.goto(`/c/${slug}`);
    await expect(sectionLinks(requester.page)).toHaveCount(4);
    await expect(async () => {
      await requester.page.goto(`/c/${slug}`);
      await bell(requester.page).click();
      await expect(
        requester.page.getByRole("link", { name: /Your request to join was approved/ }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 150_000, intervals: [3_000, 5_000] });
    await expect(
      requester.page.getByRole("link", { name: /Your request to join was declined/ }),
    ).toBeVisible();
  });
});

test("step 10 joining: invite links that need approval, invite only copy, and the paid path", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Workshop ${uniqueSuffix()}`, "private");

  await test.step("an invite link that needs approval creates a request", async () => {
    const invite = await createInviteLink(owner.page, slug, { requiresApproval: true });
    const invited = await actor("Ivy");
    await invited.page.goto(invite);
    await settle(invited.page);
    await invited.page.getByRole("button", { name: "Join community" }).click();
    await expect(invited.page).toHaveURL((url) => url.pathname === `/c/${slug}/about`, {
      timeout: 30_000,
    });
    await expect(invited.page.getByText("Request pending")).toBeVisible();
    await expectSections(invited.page, []);
    await owner.page.goto(`/c/${slug}/manage/people?tab=requests`);
    await settle(owner.page);
    await expect(
      owner.page.getByRole("listitem", { name: `Request from ${invited.person.name}` }),
    ).toBeVisible();
  });

  await test.step("invite only explains how to get in", async () => {
    await saveJoinSettings(owner.page, slug, { mode: "Invite only" });
    const visitor = await actor("Vic");
    await visitor.page.goto(`/c/${slug}`);
    await expect(visitor.page.getByText("Invite only", { exact: true })).toBeVisible();
    await expect(
      visitor.page.getByText("New members join with an invite link. Ask a member to share one."),
    ).toBeVisible();
    await expect(visitor.page.getByRole("button", { name: /Request/ })).toHaveCount(0);
    await expectAccessible(visitor.page, "about (invite only)");
  });

  await test.step("a paid community: payment is the approval and questions come before checkout", async () => {
    const paidSlug = await createCommunity(owner.page, `Paid guild ${uniqueSuffix()}`, "private");
    await connectStripeAndSavePlan(owner.page, paidSlug);
    await owner.page.goto(`/c/${paidSlug}/manage/settings/joining`);
    await settle(owner.page);
    await expect(owner.page.getByRole("radio", { name: /^Approval / })).toBeDisabled();
    await expect(owner.page.getByRole("radio", { name: /^Open / })).toBeChecked();
    await expect(
      owner.page.getByText(
        "Paid communities: payment is the approval. Stop selling memberships to use Approval.",
      ),
    ).toBeVisible();
    await owner.page.getByRole("button", { name: "Add a question" }).click();
    await owner.page.getByLabel("Question 1").fill(question);
    await owner.page.getByRole("switch", { name: "Answer required" }).click();
    await owner.page.getByRole("button", { name: "Save join settings" }).click();
    await expect(owner.page.getByText("Join settings saved.")).toBeVisible();

    const buyer = await actor("Ben");
    await buyer.page
      .context()
      .route(/^https:\/\/checkout\.stripe\.test\//, (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe</title>" }),
      );
    await buyer.page.goto(`/c/${paidSlug}`);
    await settle(buyer.page);
    await expect(buyer.page.getByRole("button", { name: /Request/ })).toHaveCount(0);
    const join = buyer.page.getByRole("link", { name: "Join for $29.00/month" }).first();
    await expect(join).toBeVisible();
    await join.click();
    await expect(buyer.page).toHaveURL((url) => url.pathname === `/c/${paidSlug}/membership`);
    await expect(
      buyer.page.getByRole("heading", { name: "A few questions before you pay" }),
    ).toBeVisible();
    await expectAccessible(buyer.page, "membership (questions before checkout)");
    await settle(buyer.page);
    const buy = buyer.page.getByRole("button", { name: "Join for $29.00/month" });
    await buy.click();
    await expect(buyer.page.getByText("Answer this question to join.")).toBeVisible();
    await buyer.page.getByLabel(question, { exact: true }).fill("To make friends");
    await buy.click();
    await expect(buyer.page).toHaveURL(/^https:\/\/checkout\.stripe\.test\//);
  });

  await test.step("an invite only paid community sells only to people with an invite", async () => {
    const paidSlug = await createCommunity(owner.page, `Invite guild ${uniqueSuffix()}`, "public");
    await connectStripeAndSavePlan(owner.page, paidSlug);
    await saveJoinSettings(owner.page, paidSlug, { mode: "Invite only" });

    const visitor = await actor("Vera");
    await visitor.page.goto(`/c/${paidSlug}/about`);
    await settle(visitor.page);
    await expect(visitor.page.getByText("Invite only", { exact: true }).first()).toBeVisible();
    await expect(visitor.page.getByRole("link", { name: /Join for/ })).toHaveCount(0);
    await expect(visitor.page.getByRole("button", { name: /Join for/ })).toHaveCount(0);
    await visitor.page.goto(`/c/${paidSlug}/membership`);
    await expect(visitor.page.getByText(/New members join .* with an invite link/)).toBeVisible();
    await expect(visitor.page.getByRole("button", { name: /Join for/ })).toHaveCount(0);

    const invite = await createInviteLink(owner.page, paidSlug);
    await expect(owner.page.getByText(/People with this link still pay to join/)).toBeVisible();
    await expect(
      owner.page.getByRole("switch", { name: "People who use this link need approval" }),
    ).toBeDisabled();
    await expect(owner.page.getByText(/payment is the approval, so invite links/)).toBeVisible();
    await expect(owner.page.getByText(/needs approval/)).toHaveCount(0);
    await expectAccessible(owner.page, "invite links (paid)");
    await visitor.page.goto(invite);
    await settle(visitor.page);
    await visitor.page.getByRole("button", { name: "Join community" }).click();
    await expect(visitor.page).toHaveURL((url) => url.pathname === `/c/${paidSlug}/membership`, {
      timeout: 30_000,
    });
    await expect(visitor.page.getByRole("button", { name: "Join for $29.00/month" })).toBeVisible();
  });
});
