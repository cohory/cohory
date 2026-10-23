import { describe, expect, it } from "vitest";

import { weeklyDigestEmail, type WeeklyDigestCommunity } from "./weekly-digest";

const links = {
  unsubscribeUrl: "https://cohory.test/unsubscribe?token=t",
  preferencesUrl: "https://cohory.test/account/notifications",
};

const makers: WeeklyDigestCommunity = {
  name: "Makers",
  url: "https://cohory.test/c/makers",
  newPostCount: 4,
  newMemberCount: 5,
  newMemberNames: ["Jamie", "Taylor", "Sam"],
  topPosts: [
    {
      title: "Show your workbench",
      firstLine: "Post a photo of where you make things.",
      commentCount: 12,
      url: "https://cohory.test/c/makers/posts/p1",
    },
    {
      title: "Glaze test results",
      firstLine: "Three glazes, one kiln.",
      commentCount: 1,
      url: "https://cohory.test/c/makers/posts/p2",
    },
  ],
  events: [
    {
      title: "Studio hours",
      when: "Thursday, October 29 at 6:00 PM",
      day: "Thursday",
      url: "https://cohory.test/c/makers/calendar/studio/o1",
    },
  ],
  progress: {
    text: "You are 40% through Wheel basics. Next: Centering.",
    url: "https://cohory.test/c/makers/classroom/wheel/centering",
  },
  ownerSummary: null,
};

describe("weeklyDigestEmail", () => {
  it("leads with the top post of a single community and lists what happened", () => {
    const email = weeklyDigestEmail({ name: "Ada", communities: [makers], ...links });

    expect(email.subject).toBe("[Makers] This week: Show your workbench");
    expect(email.text).toContain("4 new posts, 5 new members, next event Thursday.");
    expect(email.text).toContain("Show your workbench");
    expect(email.text).toContain("Post a photo of where you make things. 12 comments");
    expect(email.text).toContain("Glaze test results");
    expect(email.text).toContain("1 comment");
    expect(email.text).toContain("New members: Jamie, Taylor, Sam, and 2 more.");
    expect(email.text).toContain("Studio hours");
    expect(email.text).toContain("Thursday, October 29 at 6:00 PM");
    expect(email.text).toContain("You are 40% through Wheel basics. Next: Centering.");
    expect(email.text).toContain("https://cohory.test/unsubscribe?token=t");
    expect(email.html).toContain("Open Makers");
    expect(email.html).toContain("Stop weekly digests");
  });

  it("combines several communities under one plain subject", () => {
    const email = weeklyDigestEmail({
      name: "Ada",
      communities: [
        makers,
        {
          ...makers,
          name: "Gardeners",
          url: "https://cohory.test/c/gardeners",
          events: [],
          progress: null,
          ownerSummary: "This week: 2 new paying members, 1 cancellation.",
        },
      ],
      ...links,
    });

    expect(email.subject).toBe("This week in your communities");
    expect(email.text).toContain("Makers");
    expect(email.text).toContain("Gardeners");
    expect(email.text).toContain("This week: 2 new paying members, 1 cancellation.");
    expect(email.text).toContain("https://cohory.test/c/gardeners");
  });
});
