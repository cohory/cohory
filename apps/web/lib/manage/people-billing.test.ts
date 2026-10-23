import { describe, expect, it } from "vitest";

import { bulkRemovalDescription, removalDescription } from "./people-billing";

const removeText = "They lose access right away.";

describe("removalDescription", () => {
  it("keeps the plain text for a member who does not pay", () => {
    expect(removalDescription("Ada", { paying: false }, removeText)).toBe(removeText);
  });

  it("states the price and that the subscription ends now with no refund", () => {
    expect(
      removalDescription(
        "Ada",
        { paying: true, amountMinor: 4900, currency: "usd", interval: "month" },
        removeText,
      ),
    ).toBe(`Ada pays $49.00 per month. Their subscription ends now with no refund. ${removeText}`);
  });

  it("names the year for an annual subscription", () => {
    expect(
      removalDescription(
        "Ada",
        { paying: true, amountMinor: 49_000, currency: "eur", interval: "year" },
        removeText,
      ),
    ).toContain("Ada pays €490.00 per year.");
  });

  it("still warns when the price is not known", () => {
    expect(
      removalDescription(
        "Ada",
        { paying: true, amountMinor: null, currency: null, interval: null },
        removeText,
      ),
    ).toBe(`Ada pays for a subscription. It ends now with no refund. ${removeText}`);
  });
});

describe("bulkRemovalDescription", () => {
  const free = { paying: false } as const;
  const monthly = { paying: true, amountMinor: 4900, currency: "usd", interval: "month" } as const;

  it("keeps the plain text when nobody selected pays", () => {
    expect(bulkRemovalDescription([{ name: "Ada", billing: free }], removeText)).toBe(removeText);
  });

  it("names each paying member and says their subscriptions end with no refund", () => {
    expect(
      bulkRemovalDescription(
        [
          { name: "Ada", billing: monthly },
          { name: "Bo", billing: free },
          {
            name: "Cy",
            billing: { paying: true, amountMinor: null, currency: null, interval: null },
          },
        ],
        removeText,
      ),
    ).toBe(
      `2 of the 3 people pay: Ada pays $49.00 per month, Cy pays for a subscription. Their subscriptions end now with no refund. ${removeText}`,
    );
  });

  it("lists five paying members and counts the rest", () => {
    const people = ["A", "B", "C", "D", "E", "F", "G"].map((name) => ({ name, billing: monthly }));

    expect(bulkRemovalDescription(people, removeText)).toContain(
      "E pays $49.00 per month, and 2 more. Their subscriptions",
    );
  });
});
