import { readFile } from "node:fs/promises";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, joinCommunity } from "../pages/community";

const documentedColumns = [
  "name",
  "email",
  "username",
  "role",
  "joined_at",
  "status",
  "level",
  "points",
  "stripe_customer_id",
  "stripe_subscription_id",
  "last_active_at",
  "access",
  "signed_in",
];

test("journey 11: the owner exports members as CSV", async ({ actor }) => {
  const owner = await actor("Olga");
  const slug = await createCommunity(owner.page, `Export ${uniqueSuffix()}`, "public");
  const member = await actor("Bea");
  await joinCommunity(member.page, slug);
  const outsider = await actor("Cal");
  await createCommunity(outsider.page, `Elsewhere ${uniqueSuffix()}`, "public");

  const csv = await test.step("the Settings link downloads a named CSV", async () => {
    await owner.page.goto(`/c/${slug}/manage/settings`);
    await expectAccessible(owner.page, "manage settings");
    const [download] = await Promise.all([
      owner.page.waitForEvent("download"),
      owner.page.getByRole("link", { name: "Download members CSV" }).click(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    expect(download.suggestedFilename()).toBe(`${slug}-members-${today}.csv`);
    const path = await download.path();
    return readFile(path, "utf8");
  });

  await test.step("the CSV has the documented columns and only this community", async () => {
    const lines = csv
      .replace(/^\uFEFF/, "")
      .trimEnd()
      .split(/\r?\n/);
    const header = (lines[0] ?? "").split(",");
    expect([...header].sort()).toEqual([...documentedColumns].sort());
    const emailColumn = header.indexOf("email");
    const emails = lines.slice(1).map((line) => line.split(",")[emailColumn]);
    expect(emails).toEqual(expect.arrayContaining([owner.person.email, member.person.email]));
    expect(emails).not.toContain(outsider.person.email);
    expect(emails).toHaveLength(2);
  });

  await test.step("a member cannot export", async () => {
    const response = await member.context.request.get(
      `/api/v1/communities/${slug}/manage/export/members.csv`,
    );
    expect(response.status()).toBe(403);
    const page = await member.page.goto(`/c/${slug}/manage/settings`);
    expect(page?.status()).toBe(404);
  });
});
