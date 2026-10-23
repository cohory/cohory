import { describe, expect, it, vi } from "vitest";

import type { EmailContent } from "../message";
import { changeEmailConfirmationEmail, changeEmailVerificationEmail } from "./change-email";
import { compInvitationEmail } from "./comp-invitation";
import { creatorsInviteEmail } from "./creators-invite";
import { magicLinkEmail } from "./magic-link";
import { passwordChangedEmail } from "./password-changed";
import { passwordRemovedEmail } from "./password-removed";
import { emailVerificationEmail } from "./email-verification";
import { eventCanceledEmail } from "./event-canceled";
import { eventDatesRemovedEmail } from "./event-dates-removed";
import { eventReminderEmail } from "./event-reminder";
import { rsvpConfirmationEmail } from "./rsvp-confirmation";
import { eventUpdatedEmail } from "./event-updated";
import { existingAccountSignUpEmail } from "./existing-account-sign-up";
import { communityMovedEmail, memberAddedEmail, memberInvitedEmail } from "./migration";
import { notificationDigestEmail, notificationEmail } from "./notification";
import { feeClearRequiredEmail, paidMembershipChangedEmail } from "./paid-membership";
import { passwordResetEmail } from "./password-reset";
import { duplicateRefundedEmail } from "./duplicate-refunded";
import { paymentDisputedEmail } from "./payment-disputed";
import { platformBillingPausedEmail, platformInvoicePaymentFailedEmail } from "./platform-billing";
import { movingOfferEmail } from "./moving-offer";
import { subscriptionMovedEmail } from "./subscription-moved";
import { testEmail } from "./test-email";
import { renewalReminderEmail } from "./renewal-reminder";
import { tokenExpiringEmail } from "./token-expiring";
import { webhookEndpointDisabledEmail } from "./webhook-disabled";
import { welcomeEmail } from "./welcome";

vi.stubEnv("APP_URL", "https://community.example.com");
vi.stubEnv("BETTER_AUTH_URL", "");
vi.stubEnv("INSTANCE_NAME", "");
vi.stubEnv("INSTANCE_LOGO_URL", "");

const app = "https://community.example.com";
const community = "Design Club";
const brand = { logoUrl: "https://cdn.example.com/design-club.png", accent: "#7C3AED" };
const links = { unsubscribeUrl: `${app}/unsubscribe?token=t`, preferencesUrl: `${app}/account` };
const invoice = {
  communityName: community,
  periodLabel: "October 2026",
  amountMinor: 1250,
  currency: "usd",
  url: "https://invoice.stripe.com/i/test",
  billingUrl: "https://cohory.test/c/clay/manage/payments/platform-fees",
};
const paid = {
  communityName: community,
  endsAt: new Date("2026-11-18T10:00:00.000Z"),
  supportContact: "owner@example.test",
  portalLoginUrl: "https://billing.stripe.com/p/login/test",
  membershipUrl: `${app}/c/design-club/membership`,
};
const event = { name: "Ada", communityName: community, communityBrand: brand };

const account: Record<string, () => EmailContent> = {
  "email-verification": () => emailVerificationEmail({ name: "Ada", url: `${app}/verify?t=1` }),
  "existing-account-sign-up": () =>
    existingAccountSignUpEmail({
      name: "Ada",
      signInUrl: `${app}/sign-in`,
      resetUrl: `${app}/forgot-password`,
    }),
  "magic-link": () => magicLinkEmail({ url: `${app}/magic?t=1`, expiresInMinutes: 15 }),
  "change-email-verification": () =>
    changeEmailVerificationEmail({
      name: "Ada",
      newEmail: "ada.new@example.com",
      url: `${app}/verify?t=1`,
      expiresInMinutes: 60,
    }),
  "change-email-confirmation": () =>
    changeEmailConfirmationEmail({
      name: "Ada",
      newEmail: "ada.new@example.com",
      url: `${app}/verify?t=1`,
      expiresInMinutes: 60,
      securityUrl: `${app}/forgot-password`,
    }),
  "password-changed": () =>
    passwordChangedEmail({
      name: "Ada",
      changedAt: new Date("2026-10-22T09:30:00.000Z"),
      device: "Firefox on macOS",
      resetUrl: `${app}/forgot-password`,
    }),
  "password-removed": () =>
    passwordRemovedEmail({ name: "Ada", securityUrl: `${app}/account/security` }),
  "password-reset": () =>
    passwordResetEmail({ name: "Ada", url: `${app}/reset?t=1`, expiresInMinutes: 60 }),
  "notification-digest": () =>
    notificationDigestEmail({
      name: "Ada",
      subject: "Cy commented on your post and 1 more",
      items: [
        { text: "Cy commented on your post", communityName: community, url: `${app}/p/1` },
        { text: "Bo mentioned you", communityName: "Makers", url: `${app}/p/2` },
      ],
      ...links,
    }),
  test: () => testEmail(),
};

const communityEmails: Record<string, () => EmailContent> = {
  "comp-invitation": () =>
    compInvitationEmail({
      communityName: community,
      email: "ada@example.test",
      url: `${app}/c/design-club/membership`,
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      communityBrand: brand,
    }),
  "creators-invite": () =>
    creatorsInviteEmail({
      name: "Ada",
      communityName: community,
      inviterName: "Riza",
      url: `${app}/join/abc`,
      expiresAt: new Date("2026-11-22T09:00:00.000Z"),
      communityBrand: brand,
      optOutUrl: `${app}/email-opt-out?token=t`,
    }),
  "subscription-moved": () =>
    subscriptionMovedEmail({
      communityName: community,
      email: "ada@example.test",
      url: `${app}/c/design-club/membership`,
    }),
  "moving-offer": () =>
    movingOfferEmail({
      communityName: community,
      email: "ada@example.test",
      url: `${app}/c/design-club/membership`,
      freeUntil: new Date("2026-11-18T00:00:00.000Z"),
      from: "Skool",
      communityBrand: brand,
    }),
  welcome: () =>
    welcomeEmail({
      name: "Ada",
      communityName: community,
      creatorName: "Riza",
      communityBrand: brand,
      introduceUrl: `${app}/c/design-club?compose=1`,
      feedUrl: `${app}/c/design-club`,
      firstCourse: { title: "Start here", url: `${app}/c/design-club/classroom/start-here` },
      nextEvent: {
        title: "Office hours",
        when: "Thursday, October 22, 3:00 PM",
        url: `${app}/c/design-club/calendar/office-hours/o1`,
      },
      preferencesUrl: `${app}/account/notifications`,
    }),
  "event-reminder": () =>
    eventReminderEmail({
      ...event,
      title: "Office hours",
      when: "Thursday, October 22, 3:00 PM (Europe/Istanbul)",
      eventWhen: "Thursday, October 22, 2:00 PM (Europe/Berlin)",
      location: "https://meet.example.com/office",
      eventUrl: `${app}/c/design-club/calendar/office-hours/o1`,
      footer: {
        unsubscribeUrl: `${app}/unsubscribe?token=t`,
        preferencesUrl: `${app}/account/notifications`,
      },
    }),
  "rsvp-confirmation": () =>
    rsvpConfirmationEmail({
      ...event,
      title: "Office hours",
      when: "Thursday, October 22, 3:00 PM (Europe/Istanbul)",
      eventWhen: null,
      location: "Room 4",
      eventUrl: `${app}/c/design-club/calendar/office-hours/o1`,
      icsUrl: `${app}/api/v1/communities/design-club/calendar/occurrences/o1/ics`,
      footer: {
        unsubscribeUrl: `${app}/unsubscribe?token=t`,
        preferencesUrl: `${app}/account/notifications`,
      },
    }),
  "event-updated": () =>
    eventUpdatedEmail({
      ...event,
      eventTitle: "Office hours",
      oldStart: "Thursday 3:00 PM",
      newStart: "Thursday 4:00 PM",
      series: false,
      eventUrl: `${app}/c/design-club/calendar/e1`,
      icsUrl: `${app}/c/design-club/calendar/e1.ics`,
    }),
  "event-canceled": () =>
    eventCanceledEmail({
      ...event,
      title: "Office hours",
      when: "Thursday, October 22, 3:00 PM (Europe/Istanbul)",
      reason: "canceled",
      calendarUrl: `${app}/c/design-club/calendar`,
    }),
  "event-dates-removed": () =>
    eventDatesRemovedEmail({
      ...event,
      eventTitle: "Office hours",
      dates: ["Thursday, October 29"],
      calendarUrl: `${app}/c/design-club/calendar`,
    }),
  "community-moved": () =>
    communityMovedEmail({
      name: "Ada",
      communityName: community,
      url: app,
      move: { inviterName: "Grace", origin: { kind: "platform", name: "Skool" } },
      moved: ["posts", "comments"],
    }),
  "member-added": () =>
    memberAddedEmail({ name: "Ada", communityName: community, url: app, hasPassword: true }),
  "member-invited": () => memberInvitedEmail({ name: "Ada", communityName: community, url: app }),
  notification: () =>
    notificationEmail({
      name: "Ada",
      subject: "Office hours this week",
      items: [
        { sentence: `Cy replied to your comment in ${community}.`, excerpt: "Tuesday works." },
      ],
      cta: { label: "Open the comment", url: `${app}/c/design-club/posts/p1` },
      communityName: community,
      reason: "replies to your comments",
      communityBrand: brand,
      ...links,
    }),
  "paid-membership-changed": () =>
    paidMembershipChangedEmail({ ...paid, change: "billed_by_creator" }),
  "fee-clear-required": () =>
    feeClearRequiredEmail({
      communityName: community,
      dashboardUrl: "https://dashboard.stripe.com",
    }),
  "duplicate-refunded": () =>
    duplicateRefundedEmail({
      communityName: community,
      amountMinor: 4900,
      currency: "usd",
      membershipUrl: "https://cohory.test/c/design-club/membership",
    }),
  "payment-disputed": () =>
    paymentDisputedEmail({
      communityName: community,
      amountMinor: 2000,
      currency: "eur",
      dashboardUrl: "https://dashboard.stripe.com/disputes",
    }),
  "platform-invoice-payment-failed": () => platformInvoicePaymentFailedEmail(invoice),
  "platform-billing-paused": () => platformBillingPausedEmail(invoice),
  "renewal-reminder": () =>
    renewalReminderEmail({
      communityName: community,
      amountMinor: 29000,
      currency: "usd",
      renewsAt: new Date("2026-11-18T10:00:00.000Z"),
      membershipUrl: `${app}/c/design-club/membership`,
      communityBrand: brand,
    }),
  "token-expiring": () =>
    tokenExpiringEmail({
      communityName: community,
      communityBrand: brand,
      tokenName: "Nightly sync",
      agentName: null,
      expiresAt: new Date("2026-11-18T10:00:00.000Z"),
      now: new Date("2026-11-12T09:00:00.000Z"),
      url: `${app}/account/api-tokens`,
    }),
  "webhook-endpoint-disabled": () =>
    webhookEndpointDisabledEmail({
      communityName: community,
      endpointHost: "hooks.example.com",
      url: `${app}/c/design-club/manage/settings/webhooks`,
    }),
};

const all = { ...account, ...communityEmails };

describe.each(Object.entries(all))("%s", (template, render) => {
  const email = render();

  it("renders through the shared layout", () => {
    expect(email.template).toBe(template);
    expect(email.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(email.html.match(/<html/g)).toHaveLength(1);
  });

  it("has a non empty preheader", () => {
    expect(email.html).toMatch(/<div style="display:none;[^>]*>(?!&#847;)[^<]{8,}/);
  });

  it("matches the snapshot", () => {
    expect(email).toMatchSnapshot();
  });
});

describe.each(Object.entries(communityEmails))("%s subject and sender", (_template, render) => {
  it("starts with the community and sends as the community via the instance", () => {
    const email = render();
    expect(email.subject.startsWith(`[${community}] `)).toBe(true);
    expect(email.fromName).toBe(`${community} via Cohory`);
  });
});

describe.each(Object.entries(account))("%s subject and sender", (_template, render) => {
  it("has no community prefix and sends as the instance", () => {
    const email = render();
    expect(email.subject.startsWith("[")).toBe(false);
    expect(email.fromName).toBe("Cohory");
  });
});
