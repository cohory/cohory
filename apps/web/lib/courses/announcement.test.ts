import { contentDocumentSchema } from "@cohory/content";
import { describe, expect, it } from "vitest";

import { courseAnnouncement } from "./announcement";

describe("course announcement", () => {
  it("names the course and links to it from the feed post", () => {
    const post = courseAnnouncement({
      title: "Paid Community Playbook",
      description: "Four weeks to your first paying members.",
      url: "https://app.example.com/c/makers/classroom/paid-community-playbook",
    });

    expect(post.title).toBe("New course: Paid Community Playbook");
    expect(JSON.stringify(post.body)).toContain("Four weeks to your first paying members.");
    expect(JSON.stringify(post.body)).toContain(
      "https://app.example.com/c/makers/classroom/paid-community-playbook",
    );
    expect(contentDocumentSchema.safeParse(post.body).success).toBe(true);
  });

  it("keeps the title within the post title limit for long course titles", () => {
    const post = courseAnnouncement({
      title: "x".repeat(120),
      description: null,
      url: "https://app.example.com/c/makers/classroom/x",
    });

    expect(post.title.length).toBeLessThanOrEqual(120);
    expect(post.title.endsWith("…")).toBe(true);
    expect(contentDocumentSchema.safeParse(post.body).success).toBe(true);
  });
});
