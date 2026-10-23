import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { settle } from "./feed";

export interface EventFields {
  readonly title: string;
  readonly date: string;
  readonly time: string;
  readonly durationMinutes: number;
  readonly location: string;
  readonly weekly?: boolean;
}

export interface Occurrence {
  readonly id: string;
  readonly startsAt: string;
  readonly event: { readonly slug: string };
}

export async function createEvent(page: Page, slug: string, fields: EventFields): Promise<void> {
  await page.goto(`/c/${slug}/calendar/new`);
  await settle(page);
  await page.getByLabel("Title").fill(fields.title);
  await page.getByLabel("Date", { exact: true }).fill(fields.date);
  await page.getByLabel("Start time").fill(fields.time);
  const zone = page.getByRole("combobox", { name: "Time zone" });
  await zone.click();
  await zone.fill("Berlin");
  await page.getByRole("option", { name: /^Berlin \(UTC/ }).waitFor();
  await zone.press("Enter");
  await expect(zone).toHaveValue(/^Berlin \(UTC/);
  await page.getByLabel("Duration", { exact: true }).selectOption(String(fields.durationMinutes));
  await page.getByLabel("Location").fill(fields.location);
  if (fields.weekly) {
    await page.getByRole("button", { name: "More options" }).click();
    const repeat = page.getByRole("switch", { name: "Repeats weekly" });
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-checked", "true");
  }
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith(`/c/${slug}/calendar/`) && !url.pathname.endsWith("/new"),
    {
      timeout: 30_000,
    },
  );
}

export async function listOccurrences(
  request: APIRequestContext,
  slug: string,
  from: string,
  to: string,
): Promise<Occurrence[]> {
  const response = await request.get(
    `/api/v1/communities/${slug}/calendar/occurrences?from=${from}T00:00:00Z&to=${to}T00:00:00Z`,
  );
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("occurrence list has no data array");
  }
  return body.data.filter(isOccurrence);
}

function isOccurrence(value: unknown): value is Occurrence {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "startsAt" in value &&
    typeof value.startsAt === "string" &&
    "event" in value &&
    typeof value.event === "object" &&
    value.event !== null &&
    "slug" in value.event &&
    typeof value.event.slug === "string"
  );
}

export function occurrencePath(slug: string, eventSlug: string, id: string): string {
  return `/c/${slug}/calendar/${eventSlug}/${id}`;
}

export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
