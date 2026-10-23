import { describe, expect, it } from "vitest";

import {
  defaultEmailMode,
  defaultTypePreferences,
  resolvePreferences,
  updatePreferencesInputSchema,
} from "./preferences";

describe("resolvePreferences", () => {
  it("uses the documented defaults when nothing is stored", () => {
    expect(resolvePreferences([], null)).toEqual({
      types: [
        { type: "mention", inApp: true, email: "immediate" },
        { type: "reply", inApp: true, email: "immediate" },
        { type: "comment_on_post", inApp: true, email: "daily" },
        { type: "join_request", inApp: true, email: "immediate" },
        { type: "join_request_approved", inApp: true, email: "immediate" },
        { type: "join_request_declined", inApp: true, email: "immediate" },
        { type: "approval_request", inApp: true, email: "immediate" },
        { type: "agent_access", inApp: true, email: "immediate" },
        { type: "report_actioned", inApp: true, email: "off" },
        { type: "report_dismissed", inApp: true, email: "off" },
        { type: "review_created", inApp: true, email: "immediate" },
        { type: "member_joined", inApp: true, email: "daily" },
        { type: "like_on_post", inApp: true, email: "off" },
        { type: "like_on_comment", inApp: true, email: "off" },
        { type: "report_created", inApp: true, email: "off" },
        { type: "paid_member_joined", inApp: true, email: "off" },
        { type: "paid_member_canceled", inApp: true, email: "off" },
        { type: "event_created", inApp: true, email: "off" },
        { type: "event_reminder", inApp: true, email: "immediate" },
        { type: "comment_on_followed_post", inApp: true, email: "daily" },
      ],
      digestHour: 8,
      timeZone: "UTC",
      weeklyDigest: true,
    });
  });

  it("overrides only the stored types", () => {
    const resolved = resolvePreferences([{ type: "reply", inApp: false, email: "off" }], {
      digestHour: 18,
      timeZone: "Europe/Berlin",
      weeklyDigest: false,
    });

    expect(resolved.types).toEqual([
      defaultTypePreferences.mention,
      { type: "reply", inApp: false, email: "off" },
      defaultTypePreferences.comment_on_post,
      defaultTypePreferences.join_request,
      defaultTypePreferences.join_request_approved,
      defaultTypePreferences.join_request_declined,
      defaultTypePreferences.approval_request,
      defaultTypePreferences.agent_access,
      defaultTypePreferences.report_actioned,
      defaultTypePreferences.report_dismissed,
      defaultTypePreferences.review_created,
      defaultTypePreferences.member_joined,
      defaultTypePreferences.like_on_post,
      defaultTypePreferences.like_on_comment,
      defaultTypePreferences.report_created,
      defaultTypePreferences.paid_member_joined,
      defaultTypePreferences.paid_member_canceled,
      defaultTypePreferences.event_created,
      defaultTypePreferences.event_reminder,
      defaultTypePreferences.comment_on_followed_post,
    ]);
    expect(resolved).toMatchObject({ digestHour: 18, timeZone: "Europe/Berlin" });
  });

  it("ignores stored rows for types that are not delivered", () => {
    const resolved = resolvePreferences(
      [{ type: "paid_membership_changed", inApp: false, email: "off" }],
      null,
    );

    expect(resolved.types.map((item) => item.type)).not.toContain("paid_membership_changed");
    expect(resolved.types).toHaveLength(20);
  });

  it("falls back to the viewer time zone and then to UTC", () => {
    expect(resolvePreferences([], null, "America/New_York").timeZone).toBe("America/New_York");
    expect(resolvePreferences([], null, "Not/AZone").timeZone).toBe("UTC");
  });
});

describe("updatePreferencesInputSchema", () => {
  it("accepts a partial update", () => {
    expect(updatePreferencesInputSchema.safeParse({ digestHour: 0 }).success).toBe(true);
  });

  it("rejects an unknown type, a duplicate type, a bad hour, and a bad zone", () => {
    for (const input of [
      { types: [{ type: "paid_membership_changed", inApp: true, email: "off" }] },
      {
        types: [
          { type: "reply", inApp: true, email: "off" },
          { type: "reply", inApp: false, email: "off" },
        ],
      },
      { digestHour: 24 },
      { timeZone: "Mars/Olympus" },
      { types: [{ type: "reply", inApp: true, email: "weekly" }] },
    ]) {
      expect(updatePreferencesInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("resolvePreferences with a role", () => {
  it("uses the role default for types nobody chose and keeps stored choices", () => {
    const join = (role: string | null) =>
      resolvePreferences([], null, undefined, role).types.find((t) => t.type === "join_request");
    expect(join("owner")?.email).toBe("immediate");
    expect(join(null)?.email).toBe("daily");
    const stored = resolvePreferences(
      [{ type: "join_request", inApp: true, email: "off" }],
      null,
      undefined,
      "admin",
    );
    expect(stored.types.find((t) => t.type === "join_request")?.email).toBe("off");
  });
});

describe("defaultEmailMode", () => {
  it("emails join requests right away to the owner and daily to admins and moderators", () => {
    expect(defaultEmailMode("join_request", "owner")).toBe("immediate");
    expect(defaultEmailMode("join_request", "admin")).toBe("daily");
    expect(defaultEmailMode("join_request", "moderator")).toBe("daily");
    expect(defaultEmailMode("join_request", null)).toBe("daily");
  });

  it("uses the type default for every other type", () => {
    expect(defaultEmailMode("mention", "admin")).toBe("immediate");
    expect(defaultEmailMode("comment_on_post", "owner")).toBe("daily");
  });
});
