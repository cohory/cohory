import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  defaultPeopleFilters,
  lastActiveLabel,
  membersCsvHref,
  parseInactiveDays,
  parsePeopleFilters,
  peopleFiltersToInput,
  peopleHref,
  peopleFiltersToParams,
  personActivityLabel,
} from "./people-filters";

const now = new Date("2026-10-19T12:00:00.000Z");

describe("lastActiveLabel", () => {
  it.each([
    ["2026-10-19T11:00:00.000Z", "Last active today"],
    ["2026-10-18T09:00:00.000Z", "Last active yesterday"],
    ["2026-10-14T12:00:00.000Z", "Last active 5 days ago"],
    ["2026-08-19T12:00:00.000Z", "Last active 2 months ago"],
    ["2024-10-01T12:00:00.000Z", "Last active 2 years ago"],
  ])("describes %s as %j", (iso, label) => {
    expect(lastActiveLabel(iso, now)).toBe(label);
  });
});

describe("personActivityLabel", () => {
  it("says an imported member has not signed in yet instead of an old last active time", () => {
    expect(
      personActivityLabel({ signedInYet: false, lastActiveAt: "2024-01-01T00:00:00Z" }, now),
    ).toBe("Not signed in yet");
  });

  it("shows the last active time once they signed in", () => {
    expect(
      personActivityLabel({ signedInYet: true, lastActiveAt: "2026-10-19T11:00:00.000Z" }, now),
    ).toBe("Last active today");
  });
});

describe("parseInactiveDays", () => {
  it.each([
    ["30", 30],
    ["1", 1],
    ["3650", 3650],
  ])("accepts %j", (raw, days) => {
    expect(parseInactiveDays(raw)).toBe(days);
  });

  it.each(["", "0", "3651", "2.5", "abc", "-3"])("rejects %j", (raw) => {
    expect(parseInactiveDays(raw)).toBeNull();
  });
});

describe("membersCsvHref", () => {
  it("adds only the filters that are set", () => {
    expect(membersCsvHref("makers", { status: "active" })).toBe(
      "/api/v1/communities/makers/manage/export/members.csv?status=active",
    );
    expect(membersCsvHref("makers", { query: "ada lo", role: "member", inactiveDays: 30 })).toBe(
      "/api/v1/communities/makers/manage/export/members.csv?query=ada+lo&role=member&inactiveDays=30",
    );
  });

  it("drops the status when filtering by inactivity, since inactive members are active", () => {
    expect(membersCsvHref("makers", { status: "banned", inactiveDays: 7 })).toBe(
      "/api/v1/communities/makers/manage/export/members.csv?inactiveDays=7",
    );
  });

  it("adds the access and never signed in filters", () => {
    expect(membersCsvHref("makers", { access: "past_due", neverSignedIn: true })).toBe(
      "/api/v1/communities/makers/manage/export/members.csv?access=past_due&neverSignedIn=true",
    );
  });
});

describe("parsePeopleFilters", () => {
  it("falls back to the defaults for missing or unknown values", () => {
    expect(
      parsePeopleFilters({ role: "king", status: "pending", activity: "x", access: "rich" }),
    ).toEqual(defaultPeopleFilters);
  });

  it("reads every filter from the search params", () => {
    expect(
      parsePeopleFilters({
        q: "ada",
        role: "admin",
        status: "banned",
        activity: "custom",
        days: "45",
        access: "cancelling",
      }),
    ).toEqual({
      query: "ada",
      role: "admin",
      status: "banned",
      activity: "custom",
      customDays: "45",
      access: "cancelling",
    });
  });

  it("takes the first value of a repeated param", () => {
    expect(parsePeopleFilters({ q: ["one", "two"] }).query).toBe("one");
  });
});

describe("peopleFiltersToParams", () => {
  it("leaves out defaults so a plain list has a clean URL", () => {
    expect(peopleFiltersToParams(defaultPeopleFilters).toString()).toBe("");
  });

  it("round trips through parsePeopleFilters", () => {
    const filters = {
      ...defaultPeopleFilters,
      query: "bo",
      role: "member" as const,
      activity: "never" as const,
      access: "none" as const,
    };

    expect(parsePeopleFilters(Object.fromEntries(peopleFiltersToParams(filters)))).toEqual(filters);
  });
});

describe("peopleFiltersToInput", () => {
  it("maps an inactivity preset to inactive days and drops the status", () => {
    expect(
      peopleFiltersToInput({ ...defaultPeopleFilters, status: "banned", activity: "30" }),
    ).toEqual({ inactiveDays: 30 });
  });

  it("maps never signed in and access", () => {
    expect(
      peopleFiltersToInput({ ...defaultPeopleFilters, activity: "never", access: "free_access" }),
    ).toEqual({ status: "active", neverSignedIn: true, access: "free_access" });
  });

  it("answers null while the custom day count is not valid", () => {
    expect(
      peopleFiltersToInput({ ...defaultPeopleFilters, activity: "custom", customDays: "0" }),
    ).toBeNull();
  });
});

describe("activeFilterCount", () => {
  it("counts the filters behind the Filters button, not the search", () => {
    expect(activeFilterCount({ ...defaultPeopleFilters, query: "ada" })).toBe(0);
    expect(
      activeFilterCount({
        ...defaultPeopleFilters,
        role: "admin",
        access: "past_due",
        activity: "7",
      }),
    ).toBe(3);
  });
});

describe("peopleHref", () => {
  it("links to People with the filters set", () => {
    expect(peopleHref("makers", { role: "member", inactiveDays: 14, paid: true })).toBe(
      "/c/makers/manage/people?role=member&inactiveDays=14&paid=1",
    );
    expect(peopleHref("makers", {})).toBe("/c/makers/manage/people");
  });

  it("opens the list on paid members inactive for that many days", () => {
    const href = peopleHref("m", { role: "member", inactiveDays: 14, paid: true });
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);

    expect(parsePeopleFilters(params)).toEqual({
      ...defaultPeopleFilters,
      role: "member",
      activity: "14",
      access: "paying",
    });
  });

  it("reads a day count that is not a preset as a custom count", () => {
    expect(parsePeopleFilters({ inactiveDays: "45" })).toMatchObject({
      activity: "custom",
      customDays: "45",
    });
    expect(parsePeopleFilters({ inactiveDays: "-3", role: ["member", "admin"] })).toEqual({
      ...defaultPeopleFilters,
      role: "member",
    });
  });
});
