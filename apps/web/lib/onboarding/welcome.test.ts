import { describe, expect, it } from "vitest";

import { inWelcomeWindow, welcomeSteps, type WelcomeFacts } from "./welcome";

const now = new Date("2026-10-22T10:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const userId = "0192f2a4-0000-7000-8000-000000000003";

const fresh: WelcomeFacts = {
  hasPhoto: false,
  hasBio: false,
  hasPosted: false,
  firstCourseSlug: "start-here",
  startedLearning: false,
  nextEventHref: "/c/makers/calendar/office-hours/o1",
  goingToEvent: false,
};

describe("inWelcomeWindow", () => {
  it("shows the welcome card to members in their first 14 days", () => {
    const window = { role: "member" as const, joinedAt: daysAgo(13), dismissed: false, now };
    expect(inWelcomeWindow(window)).toBe(true);
    expect(inWelcomeWindow({ ...window, joinedAt: daysAgo(14) })).toBe(false);
  });

  it("hides it from the owner, visitors, and members who dismissed it", () => {
    const window = { role: "member" as const, joinedAt: daysAgo(1), dismissed: false, now };
    expect(inWelcomeWindow({ ...window, role: "owner" })).toBe(false);
    expect(inWelcomeWindow({ ...window, role: null })).toBe(false);
    expect(inWelcomeWindow({ ...window, dismissed: true })).toBe(false);
  });
});

describe("welcomeSteps", () => {
  it("lists the four steps a new member has not done yet", () => {
    const steps = welcomeSteps("makers", userId, fresh);

    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["photoAndBio", false],
      ["introduce", false],
      ["firstLesson", false],
      ["rsvpNext", false],
    ]);
    expect(steps.find((step) => step.key === "photoAndBio")?.href).toBe("/account");
    expect(steps.find((step) => step.key === "introduce")?.href).toBe("/c/makers?compose=1");
    expect(steps.find((step) => step.key === "firstLesson")?.href).toBe(
      "/c/makers/classroom/start-here",
    );
  });

  it("ticks steps the member has done", () => {
    const steps = welcomeSteps("makers", userId, {
      ...fresh,
      hasPhoto: true,
      hasBio: true,
      hasPosted: true,
      startedLearning: true,
      goingToEvent: true,
    });

    expect(steps.every((step) => step.done)).toBe(true);
  });

  it("sends a member with a photo to their profile to add the bio", () => {
    const steps = welcomeSteps("makers", userId, { ...fresh, hasPhoto: true });

    expect(steps[0]).toMatchObject({ done: false, href: `/c/makers/members/${userId}` });
  });

  it("leaves out the lesson and event steps when the community has neither", () => {
    const steps = welcomeSteps("makers", userId, {
      ...fresh,
      firstCourseSlug: null,
      nextEventHref: null,
    });

    expect(steps.map((step) => step.key)).toEqual(["photoAndBio", "introduce"]);
  });
});
