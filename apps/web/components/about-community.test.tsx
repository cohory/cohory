import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AboutBodyData, VisitorHeroData } from "../lib/communities/about";
import { AboutCommunity } from "./about-community";

vi.mock("./joining/join-panel", () => ({
  JoinPanel: ({ name }: { name: string }) => <button type="button">Join {name}</button>,
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const body: AboutBodyData = {
  gallery: [],
  detailedDescription: null,
  whatYouGet: ["Weekly live calls", "A launch playbook", "Templates", "Office hours"],
  host: { name: "Riza", image: null, bio: "I ran three communities.", credential: "Founder" },
  faq: [{ q: "How do I cancel?", a: "From your account, any time." }],
};

const hero: VisitorHeroData = {
  slug: "pro",
  name: "Cohory Pro",
  description: null,
  coverUrl: null,
  privacy: "private",
  memberCount: 1,
  owner: { name: "Riza", image: null },
  rating: null,
  joinState: { kind: "sign_up", intent: "checkout", label: "Join for $10.00/month" },
  offer: { price: "$10.00/month", note: "Yearly saves $20.00. Cancel anytime." },
  hasHost: true,
  nextEvent: null,
};

describe("AboutCommunity", () => {
  it("lists what members get, the host, and the questions", () => {
    render(<AboutCommunity about={body} />);

    const list = screen.getByRole("region", { name: "What you get" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    const host = screen.getByRole("region", { name: "About the host" });
    expect(host.id).toBe("host");
    expect(within(host).getByText("Founder")).toBeDefined();
    const faq = screen.getByRole("region", { name: "Questions" });
    expect(faq.querySelector("details summary")?.textContent).toBe("How do I cancel?");
  });

  it("shows no join controls to a member", () => {
    render(<AboutCommunity about={body} />);

    expect(screen.queryByRole("button", { name: /^Join/ })).toBeNull();
    expect(document.getElementById("about-closing")).toBeNull();
  });

  it("ends with a closing call to action with the price and the cancel note", () => {
    render(<AboutCommunity about={body} join={{ hero, aboveTabs: false }} />);

    const closing = screen.getByRole("region", { name: "Join Cohory Pro" });
    expect(closing.id).toBe("about-closing");
    expect(within(closing).getByText("$10.00/month")).toBeDefined();
    expect(within(closing).getByText("Cancel anytime from your account.")).toBeDefined();
    expect(within(closing).getByRole("button", { name: "Join Cohory Pro" })).toBeDefined();
  });

  it("puts a join card with the price and three included items beside the page", () => {
    const { container } = render(<AboutCommunity about={body} join={{ hero, aboveTabs: false }} />);

    const card = container.querySelector<HTMLElement>('[data-slot="join-card"]');
    if (!card) throw new Error("join card missing");
    expect(card.parentElement?.className).toContain("lg:sticky");
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
    expect(within(card).getByText("Yearly saves $20.00. Cancel anytime.")).toBeDefined();
    expect(container.querySelector('[data-slot="sticky-join"]')).not.toBeNull();
  });

  it("repeats no join control when the visitor cannot join", () => {
    const { container } = render(
      <AboutCommunity
        about={body}
        join={{ hero: { ...hero, joinState: { kind: "invite_only" } }, aboveTabs: false }}
      />,
    );

    expect(container.querySelector('[data-slot="join-card"]')).toBeNull();
    expect(container.querySelector('[data-slot="sticky-join"]')).toBeNull();
    expect(document.getElementById("about-closing")).toBeNull();
  });
});
