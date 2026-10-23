import { describe, expect, it } from "vitest";

import { queuedEmailSchema, renderQueuedEmail } from "../queue";
import { allCopy } from "../test/copy";
import { creatorFeedbackEmail, type CreatorFeedbackInput } from "./creator-feedback";

const moment: CreatorFeedbackInput = {
  kind: "moment",
  topic: "First post",
  question: "How easy was it to publish your first post?",
  score: 4,
  reason: null,
  comment: "The editor was clear.\n\nFinding the category was not.",
  userId: "0199a1b2-0000-7000-8000-000000000001",
  communitySlug: "painters",
  edition: "cloud",
  instanceUrl: "https://cohory.example.com",
  sentAt: "2026-10-23T09:30:00.000Z",
};

const exit: CreatorFeedbackInput = {
  ...moment,
  kind: "exit",
  topic: "Archived a community",
  question: null,
  score: null,
  reason: "Too expensive",
  comment: null,
};

describe("creatorFeedbackEmail", () => {
  it("tags the subject with the moment and the score and lists the creator and community", () => {
    const email = creatorFeedbackEmail(moment);

    expect(email.subject).toBe("[Cohory feedback] First post: 4/5");
    expect(email.text).toContain("Question: How easy was it to publish your first post?");
    expect(email.text).toContain("Score: 4 of 5");
    expect(email.text).toContain("Finding the category was not.");
    expect(email.text).toContain("User id: 0199a1b2-0000-7000-8000-000000000001");
    expect(email.text).toContain("Community: painters");
    expect(email.text).toContain("Edition: cloud");
    expect(allCopy(email)).not.toContain("!");
  });

  it("tags an exit with the action and the reason, and says when no comment was given", () => {
    const email = creatorFeedbackEmail(exit);

    expect(email.subject).toBe("[Cohory feedback] Archived a community: Too expensive");
    expect(email.text).toContain("Reason: Too expensive");
    expect(email.text).toContain("Comment: none");
  });

  it("says no reason when an exit has only a comment, and no community for an account", () => {
    const email = creatorFeedbackEmail({
      ...exit,
      topic: "Deleted their account",
      reason: null,
      comment: "Done for now.",
      communitySlug: null,
    });

    expect(email.subject).toBe("[Cohory feedback] Deleted their account: no reason given");
    expect(email.text).toContain("Community: none");
  });

  it("renders through the queue schema", () => {
    const queued = queuedEmailSchema.parse({
      template: "creator-feedback",
      to: "hello@operator.example.com",
      data: moment,
    });

    expect(renderQueuedEmail(queued).subject).toBe("[Cohory feedback] First post: 4/5");
  });

  it("refuses a comment over 1000 characters or a score outside 1 to 5", () => {
    const base = { template: "creator-feedback", to: "hello@operator.example.com" };
    expect(
      queuedEmailSchema.safeParse({ ...base, data: { ...moment, comment: "a".repeat(1001) } })
        .success,
    ).toBe(false);
    expect(queuedEmailSchema.safeParse({ ...base, data: { ...moment, score: 6 } }).success).toBe(
      false,
    );
  });
});
