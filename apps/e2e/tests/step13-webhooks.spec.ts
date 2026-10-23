import { Webhook } from "standardwebhooks";

import { expectAccessible } from "../support/axe";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity, expectNoHorizontalScroll } from "../pages/community";
import { settle, writePost } from "../pages/feed";

const receiverUrl = process.env.E2E_WEBHOOK_RECEIVER_URL ?? "http://127.0.0.1:3314";
const receiverUrlForApp =
  process.env.E2E_WEBHOOK_RECEIVER_APP_URL ?? "http://webhook-receiver:12113";

interface Delivery {
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function deliveriesTo(path: string): Promise<Delivery[]> {
  const response = await fetch(`${receiverUrl}/__deliveries?path=${encodeURIComponent(path)}`);
  return (await response.json()) as Delivery[];
}

function signedHeaders(delivery: Delivery): Record<string, string> {
  return {
    "webhook-id": delivery.headers["webhook-id"] ?? "",
    "webhook-timestamp": delivery.headers["webhook-timestamp"] ?? "",
    "webhook-signature": delivery.headers["webhook-signature"] ?? "",
  };
}

test("step 13 webhooks: a signed delivery reaches a receiver, shows in the log, and stops when off", async ({
  actor,
}) => {
  test.setTimeout(240_000);
  const owner = await actor("Wanda", { desktop: true });
  const slug = await createCommunity(owner.page, `Hooks ${uniqueSuffix()}`, "public");
  const path = `/hook-${uniqueSuffix()}`;
  const url = `${receiverUrlForApp}${path}`;
  const page = owner.page;
  let secret = "";

  await test.step("the owner adds an endpoint and sees the signing secret once", async () => {
    await page.goto(`/c/${slug}/manage/settings/webhooks`);
    await settle(page);
    await expectAccessible(page, "webhooks");
    await page.getByText("How to verify requests").click();
    await expect(page.getByText("webhook-signature").first()).toBeVisible();
    await expectAccessible(page, "webhooks with the receiver guide");
    await page.getByRole("button", { name: "Add endpoint" }).click();
    const form = page.getByRole("form", { name: "Add an endpoint" });
    await form.getByLabel("Endpoint URL").fill(url);
    await form.getByRole("checkbox", { name: /post\.created/ }).check();
    await form.getByRole("button", { name: "Add endpoint" }).click();
    secret = (await page.getByTestId("webhook-secret").innerText()).trim();
    expect(secret).toMatch(/^whsec_/);
    await expectAccessible(page, "webhooks with a new secret");
    await page.reload();
    await expect(page.getByTestId("webhook-secret")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: url })).toBeVisible();
  });

  await test.step("a test event is delivered, signed, and logged", async () => {
    await page.getByRole("button", { name: "Send test event" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test event delivered" })).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(async () => (await deliveriesTo(path)).length, { timeout: 60_000 })
      .toBeGreaterThan(0);
    const [delivery] = await deliveriesTo(path);
    if (!delivery) throw new Error("no delivery");
    const verified = new Webhook(secret).verify(delivery.body, signedHeaders(delivery));
    expect(verified).toMatchObject({ type: expect.stringMatching(/test/) });
    expect(() =>
      new Webhook(`whsec_${Buffer.alloc(24, 3).toString("base64")}`).verify(
        delivery.body,
        signedHeaders(delivery),
      ),
    ).toThrow();
    await expect(async () => {
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "Delivery log" })
          .getByText("Delivered")
          .filter({ visible: true })
          .first(),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expectAccessible(page, "webhook delivery log");
  });

  await test.step("the owner opens a delivery, sees the request, and resends it", async () => {
    const before = (await deliveriesTo(path)).length;
    await page
      .getByRole("region", { name: "Delivery log" })
      .getByRole("button", { name: /^Details of Test event/ })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Test event" })).toBeVisible();
    await expect(dialog.getByText("Attempt 1")).toBeVisible();
    await dialog.getByText("Request").first().click();
    await expect(dialog.getByText("webhook-signature")).toBeVisible();
    await expect(dialog.getByText(secret.slice(6))).toHaveCount(0);
    await expectAccessible(page, "webhook delivery detail");
    await dialog.getByRole("button", { name: "Resend" }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await deliveriesTo(path)).length, { timeout: 60_000 })
      .toBeGreaterThan(before);
    const all = await deliveriesTo(path);
    expect(all.at(-1)?.headers["webhook-id"]).toBe(all[0]?.headers["webhook-id"]);
  });

  await test.step("the owner edits the endpoint in place and keeps its secret", async () => {
    await page.getByRole("button", { name: "Edit endpoint" }).click();
    const form = page.getByRole("form", { name: "Edit endpoint" });
    await form.getByLabel("Description (optional)").fill("Receiver");
    await form.getByRole("checkbox", { name: /member\.joined/ }).check();
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Member joined", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Receiver\./)).toBeVisible();
  });

  await test.step("rolling the secret signs with both secrets for a while", async () => {
    const oldSecret = secret;
    await page.getByRole("button", { name: "Rotate secret" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("checkbox", { name: "Keep the old secret working for 24 hours" }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Rotate secret" }).click();
    secret = (await page.getByTestId("webhook-secret").innerText()).trim();
    expect(secret).not.toBe(oldSecret);
    await page.getByRole("button", { name: "I saved it" }).click();
    await expect(page.getByText(/^The old secret also works until/)).toBeVisible();
    const before = (await deliveriesTo(path)).length;
    await page.getByRole("button", { name: "Send test event" }).click();
    await expect
      .poll(async () => (await deliveriesTo(path)).length, { timeout: 60_000 })
      .toBeGreaterThan(before);
    const latest = (await deliveriesTo(path)).at(-1);
    if (!latest) throw new Error("no delivery after the roll");
    for (const key of [oldSecret, secret]) {
      expect(new Webhook(key).verify(latest.body, signedHeaders(latest))).toMatchObject({
        type: "webhook.test",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, "webhooks on a phone");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("a new post sends a signed post.created event through the outbox", async () => {
    await writePost(page, slug, `Hello hooks ${uniqueSuffix()}`);
    await expect
      .poll(
        async () =>
          (await deliveriesTo(path)).filter((entry) => entry.body.includes('"post.created"'))
            .length,
        { timeout: 150_000, intervals: [2_000] },
      )
      .toBe(1);
    const created = (await deliveriesTo(path)).find((entry) =>
      entry.body.includes('"post.created"'),
    );
    if (!created) throw new Error("no post.created delivery");
    expect(new Webhook(secret).verify(created.body, signedHeaders(created))).toMatchObject({
      type: "post.created",
    });
  });

  await test.step("turning the endpoint off stops test events", async () => {
    await page.goto(`/c/${slug}/manage/settings/webhooks`);
    await settle(page);
    await page.getByRole("button", { name: "Turn off" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText("Off", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send test event" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();
  });

  await test.step("turning it back on offers to resend what failed while it was off", async () => {
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByText(/^Events from while it was off were not sent/)).toBeVisible();
    await expectAccessible(page, "webhooks after turning an endpoint back on");
    await page.getByRole("button", { name: "Resend failed deliveries" }).click();
    await expect(page.getByText(/^Events from while it was off were not sent/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send test event" })).toBeVisible();
  });
});
