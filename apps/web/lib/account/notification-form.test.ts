import { describe, expect, it } from "vitest";

import { parseNotificationPreferencesForm } from "./notification-form";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const complete = {
  digestHour: "18",
  timeZone: "Europe/Berlin",
  "inApp:mention": "on",
  "email:mention": "immediate",
  "inApp:reply": "off",
  "email:reply": "off",
  "inApp:comment_on_post": "on",
  "email:comment_on_post": "daily",
  "inApp:join_request": "on",
  "email:join_request": "immediate",
  "inApp:join_request_approved": "on",
  "email:join_request_approved": "off",
  "inApp:join_request_declined": "off",
  "email:join_request_declined": "immediate",
  "inApp:approval_request": "on",
  "email:approval_request": "immediate",
  "inApp:agent_access": "on",
  "email:agent_access": "daily",
  "inApp:report_actioned": "on",
  "email:report_actioned": "off",
  "inApp:report_dismissed": "off",
  "email:report_dismissed": "immediate",
  "inApp:review_created": "on",
  "email:review_created": "daily",
  "inApp:member_joined": "on",
  "email:member_joined": "off",
  "inApp:like_on_post": "on",
  "email:like_on_post": "off",
  "inApp:like_on_comment": "on",
  "email:like_on_comment": "off",
  "inApp:report_created": "on",
  "email:report_created": "off",
  "inApp:paid_member_joined": "on",
  "email:paid_member_joined": "off",
  "inApp:paid_member_canceled": "on",
  "email:paid_member_canceled": "off",
  "inApp:event_created": "on",
  "email:event_created": "off",
  "inApp:event_reminder": "on",
  "email:event_reminder": "off",
  "inApp:comment_on_followed_post": "on",
  "email:comment_on_followed_post": "daily",
  weeklyDigest: "off",
};

describe("parseNotificationPreferencesForm", () => {
  it("reads every type, the hour, the zone, and the weekly digest", () => {
    expect(parseNotificationPreferencesForm(form(complete))).toEqual({
      digestHour: 18,
      timeZone: "Europe/Berlin",
      types: [
        { type: "mention", inApp: true, email: "immediate" },
        { type: "reply", inApp: false, email: "off" },
        { type: "comment_on_post", inApp: true, email: "daily" },
        { type: "join_request", inApp: true, email: "immediate" },
        { type: "join_request_approved", inApp: true, email: "off" },
        { type: "join_request_declined", inApp: false, email: "immediate" },
        { type: "approval_request", inApp: true, email: "immediate" },
        { type: "agent_access", inApp: true, email: "daily" },
        { type: "report_actioned", inApp: true, email: "off" },
        { type: "report_dismissed", inApp: false, email: "immediate" },
        { type: "review_created", inApp: true, email: "daily" },
        { type: "member_joined", inApp: true, email: "off" },
        { type: "like_on_post", inApp: true, email: "off" },
        { type: "like_on_comment", inApp: true, email: "off" },
        { type: "report_created", inApp: true, email: "off" },
        { type: "paid_member_joined", inApp: true, email: "off" },
        { type: "paid_member_canceled", inApp: true, email: "off" },
        { type: "event_created", inApp: true, email: "off" },
        { type: "event_reminder", inApp: true, email: "off" },
        { type: "comment_on_followed_post", inApp: true, email: "daily" },
      ],
      weeklyDigest: false,
    });
  });

  it("rejects a missing or unknown email mode", () => {
    expect(
      parseNotificationPreferencesForm(form({ ...complete, "email:reply": "weekly" })),
    ).toBeNull();
    const missing = form(complete);
    missing.delete("email:mention");
    expect(parseNotificationPreferencesForm(missing)).toBeNull();
  });

  it("rejects a missing weekly digest choice", () => {
    const missing = form(complete);
    missing.delete("weeklyDigest");
    expect(parseNotificationPreferencesForm(missing)).toBeNull();
  });

  it("rejects an hour outside the day", () => {
    expect(parseNotificationPreferencesForm(form({ ...complete, digestHour: "24" }))).toBeNull();
  });
});
