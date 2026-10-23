import { describe, expect, it } from "vitest";

import { emptyReviewsLine, reviewAudience, reviewRuleLine, showReviews } from "./audience";

describe("review audience", () => {
  it("treats the owner preview as a visitor view and members by their role", () => {
    expect(reviewAudience({ member: true, preview: true })).toBe("preview");
    expect(reviewAudience({ member: true, preview: false })).toBe("member");
    expect(reviewAudience({ member: false, preview: false })).toBe("visitor");
  });

  it("hides an empty reviews block from visitors only", () => {
    expect(showReviews("visitor", 0)).toBe(false);
    expect(showReviews("visitor", 1)).toBe(true);
    expect(showReviews("preview", 0)).toBe(true);
    expect(showReviews("member", 0)).toBe(true);
  });

  it("explains to the owner in preview why visitors do not see the empty block", () => {
    expect(emptyReviewsLine("preview")).toBe(
      "No reviews yet. Visitors see this section once there is a review.",
    );
    expect(emptyReviewsLine("member")).toBe("No reviews yet.");
  });

  it("turns the review rule into a trust line for visitors", () => {
    const trust = "Every review is from a member who has paid for at least 30 days.";
    expect(reviewRuleLine("visitor")).toBe(trust);
    expect(reviewRuleLine("preview")).toBe(trust);
    expect(reviewRuleLine("member")).toBe(
      "Members who have paid for at least 30 days can leave a review.",
    );
  });
});
