import { expectAccessible } from "../support/axe";
import { nextTuesdayPairAcrossDst } from "../support/dst";
import { expect, test } from "../support/fixtures";
import { uniqueSuffix } from "../support/people";
import { addDays, createEvent, listOccurrences, occurrencePath } from "../pages/calendar";
import {
  createCommunity,
  expectBottomNavigation,
  expectNoHorizontalScroll,
  joinCommunity,
} from "../pages/community";
import { settle } from "../pages/feed";

const zoom = "https://zoom.us/j/123456789?pwd=abc";

test("journey 8: a creator schedules a weekly event across a clock change and members RSVP", async ({
  actor,
  isMobile,
}) => {
  const week = nextTuesdayPairAcrossDst();
  const owner = await actor("Olga", { desktop: true });
  const slug = await createCommunity(owner.page, `Calendar ${uniqueSuffix()}`, "public");

  const [first, second] =
    await test.step("create a weekly series at 18:00 Europe/Berlin", async () => {
      await owner.page.goto(`/c/${slug}/calendar`);
      await expectAccessible(owner.page, "calendar (owner)");
      await createEvent(owner.page, slug, {
        title: "Community call",
        date: week.first,
        time: "18:00",
        durationMinutes: 60,
        location: zoom,
        weekly: true,
      });
      await expectAccessible(owner.page, "event detail (owner)");
      const calls = (
        await listOccurrences(
          owner.context.request,
          slug,
          addDays(week.first, -1),
          addDays(week.first, 30),
        )
      ).filter((occurrence) => occurrence.event.slug === "community-call");
      expect(calls[0]?.startsAt).toBe(week.firstStartsAt);
      expect(calls[1]?.startsAt).toBe(week.secondStartsAt);
      return [calls[0], calls[1]];
    });
  if (!first || !second) throw new Error("the series has fewer than two occurrences");

  await test.step("the month view shows both weeks at 18:00 local time", async () => {
    for (const date of [week.first, week.second]) {
      await owner.page.goto(`/c/${slug}/calendar?view=month&month=${date.slice(0, 7)}`);
      await expect(owner.page.locator(`button[data-date="${date}"]`)).toContainText(
        "Community call",
      );
      const cards = owner.page
        .locator('article[data-slot="event-card"]')
        .filter({ hasText: "Community call" });
      await expect(cards.first()).toBeVisible();
      for (const text of await cards.allInnerTexts()) {
        const time = text.split("\n").find((line) => /\d{2}:\d{2}/.test(line)) ?? "";
        expect(time).toContain("18:00");
      }
    }
    await expectAccessible(owner.page, "calendar month (owner)");
  });

  const member = await actor("Bea");
  const { page } = member;
  await joinCommunity(page, slug);

  await test.step("the member RSVPs going", async () => {
    await page.goto(occurrencePath(slug, "community-call", first.id));
    await settle(page);
    const going = page
      .getByRole("group", { name: /^RSVP/ })
      .getByRole("button", { name: "Going", exact: true });
    await going.click();
    await expect(page.getByText("1 going").first()).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(
        page
          .getByRole("group", { name: /^RSVP/ })
          .getByRole("button", { name: "Going", exact: true }),
      ).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.locator('[data-slot="event-detail"]')).toContainText("zoom.us/j/123456789");
    await expectAccessible(page, "event detail (member)");
  });

  await test.step("the calendar export carries the series in its time zone", async () => {
    const response = await member.context.request.get(
      `/api/v1/communities/${slug}/calendar/events/community-call/ics`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/calendar/);
    const ics = await response.text();
    expect(ics).toContain("RRULE:FREQ=WEEKLY");
    expect(ics).toContain(`DTSTART;TZID=Europe/Berlin:${week.first.replaceAll("-", "")}T180000`);
  });

  await test.step("the owner cancels the second week", async () => {
    await owner.page.goto(occurrencePath(slug, "community-call", second.id));
    await settle(owner.page);
    await owner.page.getByRole("button", { name: "Actions for Community call" }).click();
    await owner.page.getByRole("menuitem", { name: "Cancel or delete" }).click();
    await owner.page.getByRole("button", { name: "Cancel this date" }).click();
    await expect(owner.page.getByText("This event was canceled")).toBeVisible();
  });

  await test.step("the member sees the canceled week and the export skips it", async () => {
    // The list view covers the next eight weeks, and the next clock change can be months
    // away, so the canceled week is checked in its own month.
    await page.goto(`/c/${slug}/calendar?view=month&month=${week.second.slice(0, 7)}`);
    const canceled = page
      .locator('article[data-slot="event-card"][data-canceled="true"]')
      .filter({ hasText: "Community call" });
    await expect(canceled).toHaveCount(1);
    await expect(canceled).toContainText("Canceled");
    await page.goto(`/c/${slug}/calendar?view=list`);
    if (isMobile) {
      await expect(
        page
          .locator('[data-slot="event-list"]')
          .filter({ visible: true })
          .or(page.getByText("No upcoming events").filter({ visible: true }))
          .first(),
      ).toBeVisible();
      await expect(
        page.locator('[data-slot="calendar-month"]').filter({ visible: true }),
      ).toHaveCount(0);
      await expectBottomNavigation(page);
      await expectNoHorizontalScroll(page);
    }
    await expectAccessible(page, "calendar list (member)");
    await page.goto(occurrencePath(slug, "community-call", second.id));
    await expect(page.getByText("This event was canceled")).toBeVisible();
    await expect(page.getByRole("group", { name: /^RSVP/ })).toHaveCount(0);
    const ics = await (
      await member.context.request.get(
        `/api/v1/communities/${slug}/calendar/events/community-call/ics`,
      )
    ).text();
    expect(ics).toContain(`EXDATE;TZID=Europe/Berlin:${week.second.replaceAll("-", "")}T180000`);
  });

  await test.step("the owner moves the series to 19:00 and the RSVP and links stay", async () => {
    await owner.page.goto(`${occurrencePath(slug, "community-call", first.id)}?edit=1`);
    await settle(owner.page);
    await owner.page.getByLabel("Start time").fill("19:00");
    await expect(
      owner.page.getByText("1 person is going. We'll email them the new time."),
    ).toBeVisible();
    await owner.page.getByRole("button", { name: "Save changes" }).click();
    await expect(owner.page).toHaveURL((url) => !url.search.includes("edit"), {
      timeout: 30_000,
    });

    const calls = (
      await listOccurrences(
        member.context.request,
        slug,
        addDays(week.first, -1),
        addDays(week.first, 30),
      )
    ).filter((occurrence) => occurrence.event.slug === "community-call");
    expect(calls[0]?.id).toBe(first.id);
    expect(calls[1]?.id).toBe(second.id);
    expect(new Date(calls[0]?.startsAt ?? "").getTime()).toBe(
      new Date(week.firstStartsAt).getTime() + 3_600_000,
    );

    await page.goto(occurrencePath(slug, "community-call", first.id));
    await settle(page);
    await expect(
      page
        .getByRole("group", { name: /^RSVP/ })
        .getByRole("button", { name: "Going", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1 going").first()).toBeVisible();
    await page.goto(occurrencePath(slug, "community-call", second.id));
    await expect(page.getByText("This event was canceled")).toBeVisible();
  });

  await test.step("the community home lists the upcoming call", async () => {
    await page.goto(`/c/${slug}`);
    await expect(page.locator('[data-slot="upcoming-events-card"]:visible')).toContainText(
      "Community call",
    );
  });

  await test.step("a signed in non member does not see the join link", async () => {
    const outsider = await actor("Cal");
    await outsider.page.goto(occurrencePath(slug, "community-call", first.id));
    await expect(outsider.page.locator("body")).not.toContainText("zoom.us");
    const ics = await outsider.context.request.get(
      `/api/v1/communities/${slug}/calendar/events/community-call/ics`,
    );
    expect([403, 404]).toContain(ics.status());
  });
});
