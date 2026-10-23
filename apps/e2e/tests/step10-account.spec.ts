import { expectAccessible } from "../support/axe";
import { enqueueJob, query, userIdOf } from "../support/db";
import { expect, test } from "../support/fixtures";
import { password, uniqueSuffix } from "../support/people";
import { unsubscribeToken } from "../support/unsubscribe";
import { createCommunity, expectNoHorizontalScroll, joinCommunity } from "../pages/community";
import { posts, settle, writePost } from "../pages/feed";
import { connectStripeAndSavePlan, openArchiveDialog } from "../pages/manage";

const newPassword = "another-long-and-safe-passphrase";

test("step 10 account: notification preferences at 390 wide and the unsubscribe page", async ({
  actor,
}) => {
  const who = await actor("Nia", { mobile: true });

  await test.step("preferences save and survive a reload", async () => {
    await who.page.goto("/account/notifications");
    await settle(who.page);
    await expectNoHorizontalScroll(who.page);
    await expectAccessible(who.page, "notification preferences (390 wide)");
    const prompt = who.page.getByRole("region", { name: "Confirm your email" });
    await expect(prompt).toContainText("only send notification emails and daily summaries");
    await prompt.getByRole("button", { name: "Send a new link" }).click();
    await expect(prompt).toContainText(`We sent a new link to ${who.person.email}.`);
    await who.page.getByLabel("Mentions by email").selectOption({ label: "Off" });
    await who.page.getByLabel("Comments on your posts in the app").click();
    await who.page.getByRole("button", { name: "Save changes" }).click();
    await expect(who.page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
    await who.page.reload();
    await expect(who.page.getByLabel("Mentions by email")).toHaveValue("off");
    await expect(who.page.getByLabel("Comments on your posts in the app")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  await test.step("the unsubscribe page asks for confirmation and refuses a forged link", async () => {
    const userId = await userIdOf(who.person.email);
    const guest = await actor("Guest", { signedIn: false, desktop: true });
    await guest.page.goto(`/unsubscribe?token=${unsubscribeToken(userId, "reply")}`);
    await expect(
      guest.page.getByRole("heading", { name: "Stop emails about replies to your comments?" }),
    ).toBeVisible();
    await expectAccessible(guest.page, "unsubscribe (confirm)");
    await guest.page
      .getByRole("button", { name: "Stop emails about replies to your comments" })
      .click();
    await expect(guest.page.getByRole("status")).toContainText(
      "Email for replies to your comments is off.",
    );
    await expectAccessible(guest.page, "unsubscribe (done)");
    await guest.page.goto(`/unsubscribe?token=${unsubscribeToken(userId, "reply")}x`);
    await expect(
      guest.page.getByRole("heading", { name: "This link has expired or is not valid" }),
    ).toBeVisible();
    await who.page.goto("/account/notifications");
    await expect(who.page.getByLabel("Replies to your comments by email")).toHaveValue("off");
  });
});

test("step 10 account: sessions, password change, and deleting the account", async ({
  actor,
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? "";
  const who = await actor("Sam", { desktop: true });
  const other = await browser.newContext();
  const signInElsewhere = async (secret = password) => {
    const response = await other.request.post("/api/auth/sign-in/email", {
      data: { email: who.person.email, password: secret },
      headers: { origin },
    });
    expect(response.status(), "sign in on the other device").toBe(200);
  };
  const otherPage = await other.newPage();
  const expectOtherSignedOut = async () => {
    await otherPage.goto("/account");
    await expect(otherPage).toHaveURL((url) => url.pathname === "/sign-in");
  };

  await test.step("one device can be signed out from the security page", async () => {
    await signInElsewhere();
    await who.page.goto("/account/security");
    await settle(who.page);
    await expectAccessible(who.page, "security");
    const list = who.page.getByRole("list").filter({ hasText: "This device" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list
      .getByRole("button", { name: /^Sign out / })
      .first()
      .click();
    await expect(who.page.getByText("You are not signed in anywhere else.")).toBeVisible();
    await expectOtherSignedOut();
  });

  await test.step("all other devices can be signed out at once", async () => {
    await signInElsewhere();
    await who.page.goto("/account/security");
    await settle(who.page);
    await who.page.getByRole("button", { name: "Sign out all other devices" }).click();
    await expect(who.page.getByText("You are not signed in anywhere else.")).toBeVisible();
    await expectOtherSignedOut();
  });

  await test.step("changing the password signs out the other device", async () => {
    await signInElsewhere();
    await who.page.goto("/account/security");
    await settle(who.page);
    await who.page.getByLabel("Current password").fill(password);
    await who.page.getByLabel("New password", { exact: true }).fill(newPassword);
    await who.page.getByLabel("Confirm new password").fill(newPassword);
    await who.page.getByRole("button", { name: "Change password" }).click();
    await expect(who.page.getByRole("status")).toContainText(
      "Password changed. Other devices are signed out.",
    );
    await expectOtherSignedOut();
    await signInElsewhere(newPassword);
  });

  const owner = await actor("Oda", { desktop: true });
  const slug = await createCommunity(owner.page, `Kiln club ${uniqueSuffix()}`, "public");

  await test.step("an owner with a live community cannot delete the account", async () => {
    await owner.page.goto("/account");
    await settle(owner.page);
    await expect(owner.page.getByRole("alert").filter({ hasText: "You own" })).toContainText(
      "You own a community. Transfer ownership or archive it in Settings before you delete your account.",
    );
    await expect(owner.page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
    await expectAccessible(owner.page, "account (owner block)");
  });

  await test.step("a member schedules the deletion, then cancels it after signing in", async () => {
    await joinCommunity(who.page, slug);
    await writePost(who.page, slug, "Goodbye and thanks for the clay");
    await who.page.goto("/account");
    await settle(who.page);
    const confirm = who.page.getByLabel("Type your email address to confirm");
    await expect(who.page.getByRole("button", { name: "Delete account" })).toBeDisabled();
    await confirm.fill(who.person.email);
    await who.page.getByRole("button", { name: "Delete account" }).click();
    await expect(who.page).toHaveURL((url) => url.pathname === "/sign-in", { timeout: 30_000 });
    await expectOtherSignedOut();

    await who.page.goto("/sign-in");
    await who.page.getByLabel("Email").fill(who.person.email);
    await who.page.getByLabel("Password", { exact: true }).fill(newPassword);
    await who.page.getByRole("button", { name: "Sign in" }).click();
    await expect(who.page).toHaveURL((url) => url.pathname === "/cancel-deletion", {
      timeout: 30_000,
    });
    await expect(
      who.page.getByRole("heading", { name: "Your account is scheduled for deletion" }),
    ).toBeVisible();
    await expectAccessible(who.page, "cancel deletion");
    await who.page.getByRole("button", { name: "Cancel deletion" }).click();
    await expect(who.page).toHaveURL(
      (url) => url.pathname === "/" || url.pathname.startsWith("/c/"),
      { timeout: 30_000 },
    );
    await who.page.goto("/account");
    await expect(who.page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  });

  await test.step("after the grace period the purge anonymizes the person", async () => {
    await who.page.goto("/account");
    await settle(who.page);
    await who.page.getByLabel("Type your email address to confirm").fill(who.person.email);
    await who.page.getByRole("button", { name: "Delete account" }).click();
    await expect(who.page).toHaveURL((url) => url.pathname === "/sign-in", { timeout: 30_000 });
    const userId = await userIdOf(who.person.email);
    await query(
      `update users set deletion_scheduled_for = now() - interval '1 minute' where id = '${userId}'`,
    );
    await enqueueJob("identity.account-purge");
    const [row] = await query(
      `select name, email, erased_at is not null from users where id = '${userId}'`,
    );
    expect(row?.[0]).toBe("Former member");
    expect(row?.[1]).not.toBe(who.person.email);
    expect(row?.[2]).toBe("t");
    const [membership] = await query(`select status from memberships where user_id = '${userId}'`);
    expect(membership?.[0]).toBe("removed");
    await owner.page.goto(`/c/${slug}`);
    await expect(
      posts(owner.page).filter({ hasText: "Goodbye and thanks for the clay" }),
    ).toContainText("Former member");
    const signIn = await other.request.post("/api/auth/sign-in/email", {
      data: { email: who.person.email, password: newPassword },
      headers: { origin },
    });
    expect(signIn.status(), "an erased account cannot sign in").not.toBe(200);
  });

  await other.close();
});

test("step 10 account: an owner of an archived paid community cannot delete the account", async ({
  actor,
}) => {
  const owner = await actor("Ines", { desktop: true });
  const name = `Glaze lab ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "public");
  await connectStripeAndSavePlan(owner.page, slug);
  const archive = await openArchiveDialog(owner.page, slug);
  await archive.confirm();

  await owner.page.goto("/account");
  await settle(owner.page);
  const alert = owner.page.getByRole("alert").filter({ hasText: "archived community" });
  await expect(alert).toContainText(
    "An archived community you own still bills members or has Stripe connected.",
  );
  await expect(alert.getByRole("link", { name })).toHaveAttribute(
    "href",
    `/c/${slug}/manage/payments`,
  );
  await expect(owner.page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
  await expectAccessible(owner.page, "account (archived paid community)");
});
