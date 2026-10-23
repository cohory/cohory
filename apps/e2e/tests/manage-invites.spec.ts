import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { password, uniqueSuffix } from "../support/people";
import { createCommunity, sectionLinks } from "../pages/community";
import { settle } from "../pages/feed";
import { createInviteLink } from "../pages/manage";

test("manage invites: an invite link brings a person in and revoking it stops it", async ({
  actor,
  baseURL,
}) => {
  const owner = await actor("Olga");
  const name = `Invite only ${uniqueSuffix()}`;
  const slug = await createCommunity(owner.page, name, "private");

  const invite = await test.step("the owner creates and copies an invite link", async () => {
    const link = await createInviteLink(owner.page, slug);
    expect(link.startsWith(`${baseURL}/join/`)).toBe(true);
    await expectAccessible(owner.page, "manage people");
    return link;
  });

  await test.step("a new person creates an account from the invite and lands inside", async () => {
    const guest = await actor("Gus", { signedIn: false });
    await guest.page.goto(invite);
    await expect(guest.page.getByText(`You're invited to ${name}`)).toBeVisible();
    await expect(
      guest.page.getByRole("button", { name: "I already have an account" }),
    ).toBeVisible();
    await expectAccessible(guest.page, "join page (signed out)");
    await guest.page.getByRole("button", { name: "Create account and join" }).click();
    await expect(guest.page).toHaveURL((url) => url.pathname === "/sign-up");
    await expect(guest.page.getByText(`Create your account to join ${name}.`)).toBeVisible();
    await guest.page.getByLabel("Name").fill(guest.person.name);
    await guest.page.getByLabel("Email").fill(guest.person.email);
    await guest.page.getByLabel("Password", { exact: true }).fill(password);
    await guest.page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(guest.page).toHaveURL((url) => url.pathname === `/c/${slug}`, {
      timeout: 30_000,
    });
    await expect(sectionLinks(guest.page)).toHaveCount(4);
  });

  await test.step("a signed in person joins the private community", async () => {
    const invited = await actor("Eve");
    await invited.page.goto(invite);
    await expect(invited.page.getByText(`You're invited to ${name}`)).toBeVisible();
    await expectAccessible(invited.page, "join page (signed in)");
    await settle(invited.page);
    await invited.page.getByRole("button", { name: "Join community" }).click();
    await expect(invited.page).toHaveURL((url) => url.pathname === `/c/${slug}`, {
      timeout: 30_000,
    });
    await expect(sectionLinks(invited.page)).toHaveCount(4);
  });

  await test.step("a revoked link no longer works", async () => {
    await owner.page.goto(`/c/${slug}/manage/people`);
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Invite people" }).click();
    const row = owner.page.locator("li", { has: owner.page.locator(`input[value="${invite}"]`) });
    await row.getByRole("button", { name: "Revoke" }).click();
    const dialog = owner.page.getByRole("dialog", { name: "Revoke this invite link?" });
    await dialog.getByRole("button", { name: "Revoke link", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(owner.page.locator(`input[value="${invite}"]`)).toHaveCount(0);
    await owner.page.getByRole("button", { name: /Revoked and expired links \(1\)/ }).click();
    await expect(owner.page.getByText("Unnamed link")).toBeVisible();
    const late = await actor("Fay");
    await late.page.goto(invite);
    await expect(late.page.getByText("This invite link doesn't work")).toBeVisible();
    await expect(late.page.getByRole("button", { name: "Join community" })).toHaveCount(0);
    await expectAccessible(late.page, "join page (dead link)");
  });
});
