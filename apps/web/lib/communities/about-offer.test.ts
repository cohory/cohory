import { describe, expect, it } from "vitest";

import { joinOffer, stickyJoinable, suggestedWhatYouGet, whatYouGetLines } from "./about-offer";
import type { JoinState } from "./join-state";

describe("joinOffer", () => {
  it("has no price for a free community", () => {
    expect(joinOffer(null)).toEqual({ price: null, note: null });
  });

  it("names the yearly saving and the cancel policy under a monthly price", () => {
    expect(
      joinOffer({ monthlyPriceMinor: 1000, annualPriceMinor: 10000, currency: "usd" }),
    ).toEqual({ price: "$10.00/month", note: "Yearly saves $20.00. Cancel anytime." });
  });

  it("states only the cancel policy when there is no yearly price", () => {
    expect(joinOffer({ monthlyPriceMinor: 900, annualPriceMinor: null, currency: "eur" })).toEqual({
      price: "€9.00/month",
      note: "Cancel anytime.",
    });
  });
});

describe("stickyJoinable", () => {
  const joinable: JoinState[] = [
    {
      kind: "paid",
      paidJoin: { label: "Join for $10.00/month", yearlyLabel: null, asksQuestions: false },
    },
    { kind: "sign_up", intent: "join", label: "Join community" },
    { kind: "join" },
    { kind: "request", questions: [] },
    { kind: "rejoin" },
  ];
  const notJoinable: JoinState[] = [
    { kind: "member" },
    { kind: "pending" },
    { kind: "invite_only" },
    { kind: "unavailable" },
    { kind: "declined", note: null, questions: [] },
  ];

  it.each(joinable)("repeats the join control for a $kind visitor", (state) => {
    expect(stickyJoinable(state)).toBe(true);
  });

  it.each(notJoinable)("shows no repeated join control for $kind", (state) => {
    expect(stickyJoinable(state)).toBe(false);
  });
});

describe("suggestedWhatYouGet", () => {
  it("counts published courses and upcoming events", () => {
    expect(suggestedWhatYouGet({ courses: 3, upcomingEvents: 1 })).toEqual([
      "Posts and discussions with other members",
      "3 courses in the Classroom",
      "1 upcoming event on the Calendar",
    ]);
  });

  it("leaves out what the visitor cannot count or what does not exist yet", () => {
    expect(suggestedWhatYouGet({ courses: 0, upcomingEvents: null })).toEqual([
      "Posts and discussions with other members",
    ]);
  });
});

describe("whatYouGetLines", () => {
  it("prefers what the creator wrote", () => {
    expect(whatYouGetLines(["Weekly live calls"], { courses: 2, upcomingEvents: 2 })).toEqual([
      "Weekly live calls",
    ]);
  });

  it("falls back to honest counts when the creator wrote nothing", () => {
    expect(whatYouGetLines([], { courses: 1, upcomingEvents: 0 })).toEqual([
      "Posts and discussions with other members",
      "1 course in the Classroom",
    ]);
  });
});
