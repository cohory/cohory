import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { addressHash, optOutToken } from "../support/opt-out";
import { uniqueSuffix } from "../support/people";
import { createCommunity } from "../pages/community";

type Actor = Parameters<Parameters<typeof test>[2]>[0]["actor"];

async function newCommunityId(actor: Actor): Promise<string> {
  const owner = await actor("Owner", { desktop: true });
  const slug = await createCommunity(owner.page, `Opt out ${uniqueSuffix()}`);
  const [row] = await query(`select id from communities where slug = '${slug}'`);
  if (!row?.[0]) throw new Error(`no community ${slug}`);
  return row[0];
}

async function suppressionsOf(email: string): Promise<string[][]> {
  return query(
    `select reason, source, community_id from email_suppressions where address_hash = '${addressHash(email)}'`,
  );
}

test("an invited person stops email about one community without an account", async ({ actor }) => {
  const communityId = await newCommunityId(actor);
  const email = `opt-out-${uniqueSuffix()}@example.com`;
  const guest = await actor("Guest", { signedIn: false, mobile: true });

  await test.step("the opt out page asks before it acts", async () => {
    await guest.page.goto(`/email-opt-out?token=${optOutToken(email, communityId)}`);
    await expect(
      guest.page.getByRole("heading", { name: "Stop emails about this community?" }),
    ).toBeVisible();
    await expectAccessible(guest.page, "email opt out (confirm)");
    expect(await suppressionsOf(email)).toEqual([]);
  });

  await test.step("confirming records a community opt out", async () => {
    await guest.page.getByRole("button", { name: "Stop these emails" }).click();
    await expect(guest.page.getByRole("status")).toContainText(
      "We will not email this address about the community again.",
    );
    expect(await suppressionsOf(email)).toEqual([["opt_out", "member", communityId]]);
  });

  await test.step("a forged link changes nothing", async () => {
    await guest.page.goto(`/email-opt-out?token=${optOutToken(email, communityId)}x`);
    await expect(
      guest.page.getByRole("heading", { name: "This link has expired or is not valid" }),
    ).toBeVisible();
  });
});

test("List-Unsubscribe URLs take one click POST and send GET to the confirm page", async ({
  actor,
  request,
}) => {
  const communityId = await newCommunityId(actor);
  const email = `one-click-${uniqueSuffix()}@example.com`;
  const token = optOutToken(email, communityId);

  const opened = await request.get(`/api/email-opt-out?token=${token}`, { maxRedirects: 0 });
  expect(opened.status()).toBe(303);
  expect(opened.headers()["location"]).toBe(`/email-opt-out?token=${token}`);

  const clicked = await request.post(`/api/email-opt-out?token=${token}`, {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(clicked.status()).toBe(200);
  expect(await suppressionsOf(email)).toEqual([["opt_out", "member", communityId]]);

  const notification = await request.get(
    "/api/v1/notification-preferences/unsubscribe?token=abc.def",
    { maxRedirects: 0 },
  );
  expect(notification.status()).toBe(303);
  expect(notification.headers()["location"]).toBe("/unsubscribe?token=abc.def");
});
