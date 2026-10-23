import { expectAccessible } from "../support/axe";
import { enqueueJob, query, userIdOf } from "../support/db";
import { expect, test, type Actor } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, joinCommunity } from "../pages/community";
import { posts, setLiked, settle, writeComment, writePost } from "../pages/feed";
import { connectStripeAndSavePlan } from "../pages/manage";
import { expectPoints } from "../pages/members";

async function makeModerator(owner: Actor, slug: string, who: Actor): Promise<void> {
  await owner.page.goto(`/c/${slug}/manage/people`);
  await settle(owner.page);
  await owner.page.getByRole("button", { name: `Actions for ${who.person.name}` }).click();
  await owner.page.getByRole("menuitem", { name: "Make moderator" }).click();
  await owner.page.getByRole("dialog").getByRole("button", { name: "Change role" }).click();
  await expect(owner.page.getByRole("dialog")).toBeHidden();
}

async function report(who: Actor, postPath: string, kind: "post" | "comment"): Promise<void> {
  await who.page.goto(postPath);
  await settle(who.page);
  if (kind === "post") {
    await posts(who.page).first().getByRole("button", { name: "Post options" }).click();
    await who.page.getByRole("menuitem", { name: "Report post" }).click();
  } else {
    await who.page
      .getByRole("article", { name: /^Comment by / })
      .first()
      .getByRole("button", { name: "Comment options" })
      .click();
    await who.page.getByRole("menuitem", { name: "Report comment" }).click();
  }
  const dialog = who.page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Harassment/ }).check();
  await dialog.getByLabel("Anything the moderators should know? (optional)").fill("Not kind.");
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(who.page.getByText("Thanks. The moderators will take a look.")).toBeVisible();
}

test("step 10 moderation: reports, the queue, and the ban only when the role allows it", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Forum ${uniqueSuffix()}`, "public");
  const author = await actor("Al", { desktop: true });
  const reporter = await actor("Rae", { desktop: true });
  const moderator = await actor("Mo", { desktop: true });
  for (const who of [author, reporter, moderator]) await joinCommunity(who.page, slug);
  await makeModerator(owner, slug, moderator);
  const rude = await writePost(author.page, slug, "A rude post");
  await writeComment(author.page, rude, "A rude comment");
  const ownerPost = await writePost(owner.page, slug, "The owner's post");

  await test.step("a member reports a post and a comment", async () => {
    await report(reporter, rude, "post");
    await report(reporter, rude, "comment");
    await report(reporter, ownerPost, "post");
    await expectAccessible(reporter.page, "post after reporting");
  });

  await test.step("the moderator lands on Inbox and sees the queue without a ban for the owner", async () => {
    await moderator.page.goto(`/c/${slug}/manage`);
    await expect(moderator.page).toHaveURL((url) => url.pathname === `/c/${slug}/manage/inbox`);
    await settle(moderator.page);
    await expect(
      moderator.page.getByText(
        "You are a moderator. You can approve requests, review reports, and remove or ban members.",
      ),
    ).toBeVisible();
    await expect(
      moderator.page.getByRole("navigation", { name: "Manage sections" }).getByRole("link"),
    ).toHaveText([/^Inbox/, "People"]);
    await expect(moderator.page.getByRole("tab", { name: "Reports (3)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const byAuthor = moderator.page.getByRole("listitem", { name: "Reported post by Al" });
    await expect(byAuthor.getByRole("button", { name: "Ban Al" })).toBeVisible();
    const byOwner = moderator.page.getByRole("listitem", { name: "Reported post by Olga" });
    await expect(byOwner).toBeVisible();
    await expect(byOwner.getByRole("button", { name: /^Ban / })).toHaveCount(0);
    await expect(byOwner.getByText("Harassment")).toBeVisible();
    await expect(byOwner.getByText("Not kind.")).toBeVisible();
    await expect(moderator.page.getByText(reporter.person.name)).toHaveCount(0);
    await expectAccessible(moderator.page, "manage inbox reports");
  });

  await test.step("the queue resolves by dismissing and deleting", async () => {
    const page = moderator.page;
    await page
      .getByRole("listitem", { name: "Reported post by Olga" })
      .getByRole("button", { name: "Dismiss" })
      .click();
    await expect(page.getByText("Report dismissed.")).toBeVisible();
    await expect(page.getByRole("listitem", { name: "Reported post by Olga" })).toHaveCount(0);
    const comment = page.getByRole("listitem", { name: "Reported comment by Al" });
    await comment.getByRole("button", { name: "Delete comment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete comment" }).click();
    await expect(page.getByText("Deleted.")).toBeVisible();
    await expect(comment).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Reports (1)" })).toBeVisible();
    await page.getByRole("link", { name: "Resolved" }).click();
    await expect(page.getByRole("listitem", { name: /^Reported / })).toHaveCount(2);
    await expect(page).toHaveURL(/\/manage\/inbox\?tab=reports&reports=closed$/);
    await expectAccessible(page, "manage inbox reports (resolved)");
  });

  await test.step("the ban from the queue is refused for a moderator author", async () => {
    await makeModerator(owner, slug, author);
    await moderator.page.goto(`/c/${slug}/manage/inbox?tab=reports`);
    await settle(moderator.page);
    const byAuthor = moderator.page.getByRole("listitem", { name: "Reported post by Al" });
    await expect(byAuthor).toBeVisible();
    await expect(byAuthor.getByRole("button", { name: /^Ban / })).toHaveCount(0);
    await owner.page.goto(`/c/${slug}/manage/people?tab=reports`);
    await expect(owner.page).toHaveURL(/\/manage\/inbox\?tab=reports$/);
    await settle(owner.page);
    const forOwner = owner.page.getByRole("listitem", { name: "Reported post by Al" });
    await forOwner.getByRole("button", { name: "Ban Al" }).click();
    await owner.page.getByRole("dialog").getByRole("button", { name: "Ban member" }).click();
    await expect(owner.page.getByText("Al is banned.")).toBeVisible();
    await expect(forOwner).toHaveCount(0);
    await author.page.goto(`/c/${slug}`);
    await expect(author.page.getByRole("button", { name: "Write something" })).toHaveCount(0);
  });
});

test("step 10 moderation: audit log, switcher, points reset, and comped access", async ({
  actor,
}) => {
  const owner = await actor("Olga", { desktop: true });
  const name = `Wheel ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  const member = await actor("Mia", { desktop: true });
  await joinCommunity(member.page, slug);
  const auditUrl = `/c/${slug}/manage/settings/audit-log`;

  await test.step("the audit log filters by action and exports CSV", async () => {
    await makeModerator(owner, slug, member);
    await owner.page.goto(auditUrl);
    await settle(owner.page);
    await expectAccessible(owner.page, "audit log");
    const rows = owner.page.getByRole("row");
    await expect(rows.filter({ hasText: "Member role changed" })).toHaveCount(1);
    await owner.page.getByLabel("Action").selectOption("member.role_changed");
    await owner.page.getByRole("button", { name: "Filter" }).click();
    await expect(owner.page).toHaveURL(
      (url) => url.searchParams.get("action") === "member.role_changed",
    );
    await expect(
      owner.page.getByRole("row").filter({ hasText: "Member role changed" }),
    ).toHaveCount(1);
    await owner.page.getByLabel("From").fill("2030-01-01");
    await owner.page.getByRole("button", { name: "Filter" }).click();
    await expect(owner.page.getByText("No entries match.")).toBeVisible();
    await owner.page.getByRole("link", { name: "Clear filters" }).click();
    await expect(owner.page).toHaveURL((url) => url.search === "");
    const csv = await owner.page.request.get(
      `/api/v1/communities/${slug}/manage/audit-log.csv?action=member.role_changed`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("member.role_changed");
    await owner.page.goto(auditUrl);
    await expect(
      owner.page.getByRole("row").filter({ hasText: "Audit log downloaded" }),
    ).toHaveCount(1);
  });

  await test.step("the header shows the brand, the account menu, and the community inside one", async () => {
    await owner.page.goto("/?home=1");
    const banner = owner.page.getByRole("banner");
    await expect(banner.getByRole("link", { name: "Cohory", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(banner.getByRole("link", { name: "Account" })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "Switch community" })).toHaveCount(0);
    await expect(banner.getByRole("searchbox")).toHaveCount(0);
    await expect(banner.getByText("My communities")).toHaveCount(0);

    await owner.page.goto(`/c/${slug}`);
    await expect(banner.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      `/c/${slug}`,
    );
    await expect(banner.getByRole("link", { name: "Cohory", exact: true })).toHaveCount(0);
    const trigger = banner.getByRole("button", { name: /^Open account menu for / });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await trigger.focus();
    await owner.page.keyboard.press("Enter");
    const menu = owner.page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Account" })).toBeFocused();
    await expect(menu.getByRole("menuitem", { name: "Home" })).toHaveAttribute("href", "/?home=1");
    await expect(menu.getByRole("menuitem", { name })).toHaveAttribute("aria-current", "page");
    await owner.page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await owner.page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: "Send feedback" })).toBeFocused();
    await owner.page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: "Create a community" })).toBeFocused();
    await owner.page.keyboard.press("Enter");
    await expect(owner.page).toHaveURL((url) => url.pathname === "/communities/new");
  });

  await test.step("a points reset needs the name typed and old likes cannot push below zero", async () => {
    const post = await writePost(member.page, slug, "Counting points");
    await setLiked(owner.page, post, true);
    await expectPoints(owner.page, slug, member.person.name, "1 point");
    await owner.page.goto(`/c/${slug}/manage/settings/points`);
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Reset points" }).click();
    const dialog = owner.page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reset points" })).toBeDisabled();
    await dialog.getByLabel(`Type ${name} to confirm`).fill(name);
    await dialog.getByRole("button", { name: "Reset points" }).click();
    await expect(owner.page.getByText("Points reset.")).toBeVisible();
    await expectPoints(owner.page, slug, member.person.name, "0 points");
    await setLiked(owner.page, post, false);
    await setLiked(owner.page, post, true);
    await expectPoints(owner.page, slug, member.person.name, "1 point");
    await setLiked(owner.page, post, false);
    await expectPoints(owner.page, slug, member.person.name, "0 points");
    const [row] = await query(
      `select points_total from member_stats where user_id = '${await userIdOf(member.person.email)}'`,
    );
    expect(row?.[0]).toBe("0");
  });

  await test.step("free access can be granted, revoked, and expires through the job", async () => {
    const paidSlug = await createCommunity(owner.page, `Paid wheel ${uniqueSuffix()}`, "private");
    await connectStripeAndSavePlan(owner.page, paidSlug);
    const guest = await actor("Gus", { desktop: true });
    await query(`update users set email_verified = true where email = '${guest.person.email}'`);
    const grant = async () => {
      await owner.page.goto(`/c/${paidSlug}/manage/payments`);
      await settle(owner.page);
      const form = owner.page.getByRole("form", { name: "Grant free access" });
      await form.getByLabel("Email address").fill(guest.person.email);
      await form.getByLabel("Note (optional)").fill("Guest speaker");
      await form.getByRole("button", { name: "Send offer" }).click();
      await expect(
        owner.page.getByText("Invitation sent. Access starts when they accept it."),
      ).toBeVisible();
      const invited = owner.page
        .getByRole("list", { name: "Pending invitations" })
        .getByRole("listitem")
        .filter({ hasText: guest.person.email });
      await expect(invited.getByText("Invited", { exact: true })).toBeVisible();
      await guest.page.goto(`/c/${paidSlug}/membership`);
      await settle(guest.page);
      await guest.page.getByRole("button", { name: "Accept free access" }).click();
      await expect(guest.page.getByText("Free access accepted.")).toBeVisible();
      await owner.page.reload();
      await settle(owner.page);
      const row = owner.page
        .getByRole("list", { name: "Comped members" })
        .getByRole("listitem")
        .filter({ hasText: guest.person.name });
      await expect(row.getByText("Comped")).toBeVisible();
      return row;
    };
    const row = await grant();
    await expectAccessible(owner.page, "manage payments (comped member)");
    await guest.page.goto(`/c/${paidSlug}`);
    await expect(guest.page.getByRole("button", { name: "Write something" })).toBeVisible();

    await row.getByRole("button", { name: "Revoke" }).click();
    await owner.page.getByRole("dialog").getByRole("button", { name: "Revoke access" }).click();
    await expect(owner.page.getByText("Free access revoked.")).toBeVisible();
    await expect(row).toHaveCount(0);
    await guest.page.goto(`/c/${paidSlug}`);
    await expect(guest.page.getByRole("button", { name: "Write something" })).toHaveCount(0);

    await grant();
    const guestId = await userIdOf(guest.person.email);
    await query(
      `update comped_memberships set expires_at = now() - interval '1 hour' where user_id = '${guestId}' and ended_at is null`,
    );
    await enqueueJob("payments.comps-expiry");
    const [comp] = await query(
      `select end_reason from comped_memberships where user_id = '${guestId}' order by created_at desc limit 1`,
    );
    expect(comp?.[0]).toBe("expired");
    await guest.page.goto(`/c/${paidSlug}`);
    await expect(guest.page.getByRole("button", { name: "Write something" })).toHaveCount(0);
    await owner.page.goto(`/c/${paidSlug}/manage/settings/audit-log?action=comp.expired`);
    await expect(
      owner.page.getByRole("row").filter({ hasText: "Comped access expired" }),
    ).toHaveCount(1);
  });
});
