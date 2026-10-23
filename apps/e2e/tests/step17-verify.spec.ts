import type { APIRequestContext } from "@playwright/test";

import { expectAccessible } from "../support/axe";
import { query } from "../support/db";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { createCommunity } from "../pages/community";
import { settle } from "../pages/feed";
import { payCheckout, stubStripePages } from "../pages/reviews";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3310";
const receiverUrl = process.env.E2E_WEBHOOK_RECEIVER_URL ?? "http://127.0.0.1:3314";
const receiverUrlForApp =
  process.env.E2E_WEBHOOK_RECEIVER_APP_URL ?? "http://webhook-receiver:12113";
const origin = { origin: baseUrl };
const body = (n: number) => `Review number ${n}: the weekly calls are worth every cent.`;

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function subscriptionOf(email: string): Promise<string> {
  const [row] = await query(
    `select s.id from subscriptions s join users u on u.id = s.user_id where u.email = '${email}'`,
  );
  const id = row?.[0];
  if (!id) throw new Error(`no subscription for ${email}`);
  return id;
}

async function backdate(subscriptionId: string, interval: string): Promise<void> {
  await query(
    `update subscriptions set created_at = now() - interval '${interval}' where id = '${subscriptionId}';
     update payments set occurred_at = now() - interval '${interval}' where subscription_id = '${subscriptionId}'`,
  );
}

async function postReview(request: APIRequestContext, slug: string, n: number, rating = 4) {
  return request.post(`/api/v1/communities/${slug}/reviews`, {
    headers: origin,
    data: { rating, body: body(n) },
  });
}

async function errorCode(response: { json(): Promise<unknown> }): Promise<string | undefined> {
  const json = (await response.json()) as { error?: { code?: string } };
  return json.error?.code;
}

async function summary(request: APIRequestContext, slug: string) {
  const response = await request.get(`/api/v1/communities/${slug}/reviews/summary`);
  expect(response.status()).toBe(200);
  return (await response.json()) as { status: string; count?: number; average?: number | null };
}

test("step 17 verify: review eligibility, lifecycle, moderation limits, tokens, and webhooks", async ({
  actor,
}) => {
  test.slow();
  const owner = await actor("Odette", { desktop: true });
  const ada = await actor("Ada", { desktop: true });
  const ben = await actor("Ben", { desktop: true });
  const cleo = await actor("Cleo", { desktop: true });
  await Promise.all([owner, ada, ben, cleo].map((a) => stubStripePages(a.context)));
  const slug = await createCommunity(owner.page, `Verify ${uniqueSuffix()}`, "public");
  const hookPath = `/hook-${uniqueSuffix()}`;

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

  await test.step("reviews are off by default and the About page shows none", async () => {
    expect(await summary(owner.page.request, slug)).toEqual({ status: "disabled" });
    await owner.page.goto(`/c/${slug}/about`);
    await expect(owner.page.getByRole("region", { name: "Reviews" })).toHaveCount(0);
  });

  await test.step("the owner subscribes webhooks to review events", async () => {
    await owner.page.goto(`/c/${slug}/manage/settings/webhooks`);
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Add endpoint" }).click();
    const form = owner.page.getByRole("form", { name: "Add an endpoint" });
    await form.getByLabel("Endpoint URL").fill(`${receiverUrlForApp}${hookPath}`);
    for (const type of ["review.created", "review.updated", "review.deleted", "review.hidden"]) {
      await form.getByRole("checkbox", { name: new RegExp(type.replace(".", "\\.")) }).check();
    }
    await form.getByRole("button", { name: "Add endpoint" }).click();
    await expect(owner.page.getByTestId("webhook-secret")).toBeVisible();
  });

  await test.step("three people subscribe, and reviews are turned on", async () => {
    for (const buyer of [ada, ben, cleo]) {
      await buyer.page.goto(`/c/${slug}/membership`);
      await settle(buyer.page);
      await buyer.page.getByRole("button", { name: "Join for $29.00/month" }).click();
      await expect(buyer.page).toHaveURL(/^https:\/\/checkout\.stripe\.test\/pay\/cs_/);
      await payCheckout(account);
    }
    await owner.page.goto(`/c/${slug}/manage/settings`);
    await settle(owner.page);
    await owner.page.getByRole("switch", { name: "Show reviews on the About page" }).click();
    await owner.page.getByRole("button", { name: "Save reviews setting" }).click();
    await expect(owner.page.getByText("Reviews are on.")).toBeVisible();
    await expectAccessible(owner.page, "manage settings with the reviews card");
  });

  const adaSub = await subscriptionOf(ada.person.email);
  const benSub = await subscriptionOf(ben.person.email);
  const cleoSub = await subscriptionOf(cleo.person.email);

  await test.step("day 29 is refused and day 30 is allowed", async () => {
    await backdate(adaSub, "29 days");
    const early = await postReview(ada.page.request, slug, 1);
    expect(early.status()).toBe(403);
    expect(await errorCode(early)).toBe("not_eligible");
    await backdate(adaSub, "30 days 1 minute");
    expect((await postReview(ada.page.request, slug, 1)).status()).toBe(201);
    const again = await postReview(ada.page.request, slug, 1);
    expect(again.status()).toBe(409);
  });

  await test.step("trials, past due, one time purchases, and ended subscriptions are refused", async () => {
    await backdate(benSub, "60 days");
    const cases: Array<[string, string]> = [
      ["trialing", "provider_status = 'trialing'"],
      ["past due", "provider_status = 'past_due', access_state = 'grace'"],
      ["one time", "interval = null"],
      ["comped, no paying subscription", "provider_status = 'canceled', access_state = 'revoked'"],
    ];
    for (const [label, change] of cases) {
      await query(
        `update subscriptions set provider_status = 'active', access_state = 'granted', interval = 'month' where id = '${benSub}';
         update subscriptions set ${change} where id = '${benSub}'`,
      );
      const refused = await postReview(ben.page.request, slug, 2);
      expect(refused.status(), label).toBe(403);
      expect(await errorCode(refused), label).toBe("not_eligible");
    }
  });

  await test.step("a subscription linked from the creator's Stripe counts", async () => {
    await query(
      `update subscriptions set provider_status = 'active', access_state = 'granted', interval = 'month', origin = 'linked_import' where id = '${benSub}'`,
    );
    expect((await postReview(ben.page.request, slug, 2, 5)).status()).toBe(201);
  });

  await test.step("the average stays hidden under three reviews", async () => {
    expect(await summary(ada.page.request, slug)).toMatchObject({ count: 2, average: null });
    await ada.page.goto(`/c/${slug}/about`);
    await expect(ada.page.getByRole("heading", { name: "About", exact: true })).toBeVisible();
    await expect(ada.page.getByText(/out of 5/)).toHaveCount(0);
  });

  await test.step("an admin with a paid subscription may review, and the average appears", async () => {
    await query(
      `update memberships set role = 'admin' where user_id = (select id from users where email = '${cleo.person.email}') and community_id = (select id from communities where slug = '${slug}')`,
    );
    await backdate(cleoSub, "90 days");
    expect((await postReview(cleo.page.request, slug, 3, 3)).status()).toBe(201);
    expect(await summary(owner.page.request, slug)).toMatchObject({ count: 3, average: 4 });
  });

  const reviewOf = async (name: string): Promise<string> => {
    const list = await owner.page.request.get(`/api/v1/communities/${slug}/reviews`);
    const page = (await list.json()) as { data: Array<{ id: string; author: { name: string } }> };
    const id = page.data.find((review) => review.author.name === name)?.id;
    if (!id) throw new Error(`no review by ${name}`);
    return id;
  };

  await test.step("the author edits (shown as edited), deletes, and posts again", async () => {
    const id = await reviewOf(ada.person.name);
    const edited = await ada.page.request.patch(`/api/v1/communities/${slug}/reviews/${id}`, {
      headers: origin,
      data: { rating: 5, body: body(11) },
    });
    expect(edited.status()).toBe(200);
    await ada.page.goto(`/c/${slug}/about`);
    const item = ada.page.getByRole("listitem", { name: `Review by ${ada.person.name}` });
    await expect(item.getByText(/edited/i)).toBeVisible();
    await expectAccessible(ada.page, "about as a member with reviews");
    const removed = await ada.page.request.delete(`/api/v1/communities/${slug}/reviews/${id}`, {
      headers: origin,
    });
    expect(removed.status()).toBe(204);
    expect(await summary(ada.page.request, slug)).toMatchObject({ count: 2, average: null });
    expect((await postReview(ada.page.request, slug, 12, 2)).status()).toBe(201);
  });

  await test.step("only the owner hides a reported review; an admin cannot", async () => {
    const id = await reviewOf(ada.person.name);
    const report = await ben.page.request.post(`/api/v1/communities/${slug}/reviews/${id}/report`, {
      headers: origin,
      data: { reason: "spam" },
    });
    expect(report.status()).toBe(200);
    const byAdmin = await cleo.page.request.post(`/api/v1/communities/${slug}/reviews/${id}/hide`, {
      headers: origin,
      data: { reason: "spam" },
    });
    expect(byAdmin.status()).toBe(403);
    const unreported = await reviewOf(ben.person.name);
    const notReported = await owner.page.request.post(
      `/api/v1/communities/${slug}/reviews/${unreported}/hide`,
      { headers: origin, data: { reason: "spam" } },
    );
    expect(notReported.status()).toBe(409);
    const byOwner = await owner.page.request.post(
      `/api/v1/communities/${slug}/reviews/${id}/hide`,
      { headers: origin, data: { reason: "spam" } },
    );
    expect(byOwner.status()).toBe(204);
    await owner.page.goto(`/c/${slug}/about`);
    await expect(owner.page.getByText("1 review hidden by the owner for: spam")).toBeVisible();
  });

  await test.step("the owner replies once", async () => {
    const id = await reviewOf(ben.person.name);
    const url = `/api/v1/communities/${slug}/reviews/${id}/reply`;
    const first = await owner.page.request.put(url, { headers: origin, data: { body: "Thanks" } });
    expect(first.status()).toBe(204);
    const second = await owner.page.request.put(url, { headers: origin, data: { body: "Again" } });
    expect(second.status()).toBe(409);
    const byAdmin = await cleo.page.request.put(url, { headers: origin, data: { body: "Hi" } });
    expect(byAdmin.status()).toBe(403);
  });

  await test.step("a banned author's review is hidden", async () => {
    await query(
      `update memberships set status = 'banned' where user_id = (select id from users where email = '${ben.person.email}') and community_id = (select id from communities where slug = '${slug}')`,
    );
    const list = await owner.page.request.get(`/api/v1/communities/${slug}/reviews`);
    const page = (await list.json()) as { data: Array<{ author: { name: string } }> };
    expect(page.data.map((review) => review.author.name)).not.toContain(ben.person.name);
  });

  await test.step("tokens are refused on every review write, and reads stay in their community", async () => {
    const [community] = await query(`select id from communities where slug = '${slug}'`);
    const created = await owner.page.request.post("/api/v1/me/api-tokens", {
      headers: origin,
      data: {
        communityId: community?.[0] ?? "",
        name: "Every scope",
        scopes: ["community:read", "members:read", "members:moderate", "settings:read"],
        expiresInDays: 7,
      },
    });
    expect(created.status()).toBe(201);
    const { token } = (await created.json()) as { token: string };
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const id = await reviewOf(cleo.person.name);
    const base = `${baseUrl}/api/v1/communities/${slug}/reviews`;
    const writes: Array<[string, string, unknown]> = [
      ["POST", base, { rating: 5, body: body(20) }],
      ["PATCH", `${base}/${id}`, { rating: 5, body: body(21) }],
      ["DELETE", `${base}/${id}`, undefined],
      ["PUT", `${base}/${id}/reply`, { body: "Token reply" }],
      ["PATCH", `${base}/${id}/reply`, { body: "Token reply" }],
      ["DELETE", `${base}/${id}/reply`, undefined],
      ["POST", `${base}/${id}/report`, { reason: "spam" }],
      ["POST", `${base}/${id}/hide`, { reason: "spam" }],
      ["POST", `${base}/${id}/dismiss-reports`, undefined],
    ];
    for (const [method, url, data] of writes) {
      const response = await fetch(url, {
        method,
        headers,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      expect(response.status, `${method} ${url}`).toBe(403);
      expect(await errorCode(response), `${method} ${url}`).toBe("token_not_allowed");
    }
    const read = await fetch(base, { headers });
    expect(read.status).toBe(200);

    const otherSlug = await createCommunity(owner.page, `Other ${uniqueSuffix()}`, "private");
    const foreign = await fetch(`${baseUrl}/api/v1/communities/${otherSlug}/reviews`, { headers });
    expect([403, 404]).toContain(foreign.status);
  });

  await test.step("MCP exposes only read tools for reviews", async () => {
    const response = await owner.page.request.get("/api/openapi.json");
    const spec = (await response.json()) as {
      paths: Record<string, Record<string, { "x-cohory"?: { mcp?: unknown } }>>;
    };
    const exposed = Object.entries(spec.paths)
      .filter(([path]) => path.includes("/reviews"))
      .flatMap(([path, ops]) =>
        Object.entries(ops)
          .filter(([, op]) => op["x-cohory"]?.mcp)
          .map(([method]) => `${method} ${path}`),
      );
    expect(exposed.length).toBeGreaterThan(0);
    expect(exposed.every((entry) => entry.startsWith("get "))).toBe(true);
  });

  await test.step("turning reviews off hides them and keeps them", async () => {
    await owner.page.goto(`/c/${slug}/manage/settings`);
    await settle(owner.page);
    await owner.page.getByRole("switch", { name: "Show reviews on the About page" }).click();
    await owner.page.getByRole("button", { name: "Save reviews setting" }).click();
    await expect(owner.page.getByText("Reviews are off.")).toBeVisible();
    expect(await summary(owner.page.request, slug)).toEqual({ status: "disabled" });
    await owner.page.goto(`/c/${slug}/about`);
    await expect(owner.page.getByRole("region", { name: "Reviews" })).toHaveCount(0);
    const [kept] = await query(
      `select count(*) from reviews r join communities c on c.id = r.community_id where c.slug = '${slug}'`,
    );
    expect(Number(kept?.[0])).toBe(3);
  });
  await test.step("review webhooks reach the receiver", async () => {
    await expect
      .poll(
        async () => {
          const response = await fetch(
            `${receiverUrl}/__deliveries?path=${encodeURIComponent(hookPath)}`,
          );
          const deliveries = (await response.json()) as Array<{ body: string }>;
          return [
            ...new Set(deliveries.map((d) => (JSON.parse(d.body) as { type: string }).type)),
          ].sort();
        },
        { timeout: 180_000 },
      )
      .toEqual(["review.created", "review.deleted", "review.hidden", "review.updated"]);
  });
});

test("step 17 verify: gallery limit, embed allowlist, and a sanitized description", async ({
  actor,
}) => {
  const owner = await actor("Gwen", { desktop: true });
  const slug = await createCommunity(owner.page, `Gallery ${uniqueSuffix()}`, "public");
  const api = `/api/v1/communities/${slug}/manage/appearance`;
  const request = owner.page.request;

  await test.step("a javascript: link and a host outside the allowlist are refused", async () => {
    for (const url of [
      "javascript:alert(1)",
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "http://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    ]) {
      const response = await request.post(`${api}/gallery/videos`, {
        headers: origin,
        data: { url },
      });
      expect(response.status(), url).toBe(422);
    }
  });

  await test.step("the gallery stops at 10 items", async () => {
    const image = await request.post(`${api}/gallery/images`, {
      headers: origin,
      multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } },
    });
    expect(image.status()).toBe(201);
    for (let n = 2; n <= 10; n += 1) {
      const video = await request.post(`${api}/gallery/videos`, {
        headers: origin,
        data: { url: `https://vimeo.com/${76979870 + n}` },
      });
      expect(video.status(), `item ${n}`).toBe(201);
    }
    const eleventh = await request.post(`${api}/gallery/videos`, {
      headers: origin,
      data: { url: "https://vimeo.com/76979999" },
    });
    expect(eleventh.status()).toBe(422);
    await owner.page.goto(`/c/${slug}/manage/appearance`);
    await expect(
      owner.page.getByText("The gallery is full. Remove an item to add another."),
    ).toBeVisible();
    await expect(owner.page.getByLabel("Video link")).toBeDisabled();
    await expectAccessible(owner.page, "manage appearance with a full gallery");
  });

  await test.step("the detailed description renders as text, never as markup", async () => {
    const hostile = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">';
    const saved = await request.patch(api, {
      headers: origin,
      data: {
        detailedDescription: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: hostile }] }],
        },
      },
    });
    expect(saved.status()).toBe(200);
    const badLink = await request.patch(api, {
      headers: origin,
      data: {
        detailedDescription: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "click",
                  marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(badLink.status()).toBe(422);
    const visitor = await actor("Vic", { desktop: true, signedIn: false });
    await visitor.page.goto(`/c/${slug}/about`);
    await expect(visitor.page.getByText(hostile)).toBeVisible();
    await expect(visitor.page.locator("main img[src='x']")).toHaveCount(0);
    expect(await visitor.page.evaluate(() => "__pwned" in window)).toBe(false);
    await expectAccessible(visitor.page, "about as a visitor with a full gallery");
  });
});
