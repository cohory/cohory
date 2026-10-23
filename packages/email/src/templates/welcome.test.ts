import { describe, expect, it } from "vitest";

import { welcomeEmail } from "./welcome";

const base = {
  name: "Ada",
  communityName: "Design <Club>",
  creatorName: "Riza",
  introduceUrl: "https://app.test/c/design?compose=1",
  feedUrl: "https://app.test/c/design",
  firstCourse: { title: "Start here", url: "https://app.test/c/design/classroom/start-here" },
  nextEvent: {
    title: "Office hours",
    when: "Thursday, October 22, 3:00 PM",
    url: "https://app.test/c/design/calendar/office-hours/o1",
  },
  preferencesUrl: "https://app.test/account/notifications",
};

describe("welcomeEmail", () => {
  it("welcomes the member with the creator's name and asks them to introduce themselves", () => {
    const mail = welcomeEmail(base);

    expect(mail.subject).toBe("[Design <Club>] Welcome to Design <Club>");
    expect(mail.template).toBe("welcome");
    expect(mail.text).toContain("introduce yourself and meet Riza");
    expect(mail.text).toContain(base.introduceUrl);
    expect(mail.html).toContain("Design &lt;Club&gt;");
    expect(mail.text).not.toContain("!");
  });

  it("links the feed, the first course, and the next event with its date", () => {
    const mail = welcomeEmail(base);

    expect(mail.text).toContain(`Start here: the community feed\n${base.feedUrl}`);
    expect(mail.text).toContain(`First course: Start here\n${base.firstCourse.url}`);
    expect(mail.text).toContain(
      `Next event: Office hours on Thursday, October 22, 3:00 PM\n${base.nextEvent.url}`,
    );
    expect(mail.text).toContain(base.preferencesUrl);
  });

  it("leaves out the course, the event, and the creator when the community has none", () => {
    const mail = welcomeEmail({ ...base, creatorName: null, firstCourse: null, nextEvent: null });

    expect(mail.text).not.toContain("meet");
    expect(mail.text).not.toContain("First course");
    expect(mail.text).not.toContain("Next event");
  });

  it("leaves unsafe member and creator names out", () => {
    const mail = welcomeEmail({
      ...base,
      name: '=HYPERLINK("http://x")',
      creatorName: "Visit https://evil.example now",
    });

    expect(mail.text).toContain("Hi,\n");
    expect(mail.text).not.toContain("HYPERLINK");
    expect(mail.text).not.toContain("evil.example");
    expect(mail.text).toContain("meet Visit now");
  });
});
