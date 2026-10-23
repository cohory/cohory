import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentCard, repeatedNames, type AgentItem } from "./agent-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/agents/actions", () => ({
  issueAgentTokenAction: vi.fn(),
  updateAgentAction: vi.fn(),
}));

function agent(overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    name: "Claude",
    description: null,
    scopes: ["posts:read"],
    status: "active",
    communityWide: false,
    ownerName: "Ada",
    createdAt: "2026-10-01T09:00:00.000Z",
    lastActivityAt: null,
    canManage: true,
    canIssueTokens: true,
    tokens: [],
    connections: [],
    ...overrides,
  };
}

function show(item: AgentItem, duplicate: boolean) {
  render(
    <AgentCard
      slug="garden"
      agent={item}
      duplicate={duplicate}
      now={new Date("2026-10-22T12:00:00.000Z")}
      available={["posts:read"]}
      audience="staff"
      onReveal={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe("agents with the same name", () => {
  it("finds names that repeat, ignoring case and spaces at the ends", () => {
    const names = repeatedNames([
      agent({ name: "Claude" }),
      agent({ name: " claude " }),
      agent({ name: "Nightly sync" }),
    ]);

    expect(names.has("claude")).toBe(true);
    expect(names.has("nightly sync")).toBe(false);
  });

  it("shows the connecting app and the creation date next to a repeated name", () => {
    show(
      agent({
        connections: [
          {
            grantId: "00000000-0000-7000-8000-000000000009",
            communityId: "00000000-0000-7000-8000-000000000010",
            clientName: "Claude Desktop",
            redirectHost: "claude.ai",
            connectedAt: "2026-10-01T09:00:00.000Z",
            lastUsedAt: null,
            canDisconnect: true,
          },
        ],
      }),
      true,
    );

    expect(screen.getByText(/^Claude Desktop · Created /)).toBeTruthy();
  });

  it("says an agent without a connection was created by hand", () => {
    show(agent(), true);

    expect(screen.getByText(/^Created by hand · Created /)).toBeTruthy();
  });

  it("shows nothing extra when the name is unique", () => {
    show(agent(), false);

    expect(screen.queryByText(/Created by hand/)).toBeNull();
  });
});

describe("activity links", () => {
  it("links the agent and each token to their activity", () => {
    render(
      <AgentCard
        slug="garden"
        agent={agent({
          tokens: [
            {
              id: "00000000-0000-7000-8000-000000000020",
              name: "Laptop",
              prefix: "cohory_ab",
              state: "active",
              expiresAt: "2027-10-01T09:00:00.000Z",
              lastUsedAt: null,
              lastUsedVia: null,
              oauth: false,
            },
          ],
        })}
        now={new Date("2026-10-22T12:00:00.000Z")}
        available={["posts:read"]}
        audience="member"
        activityHref="/account/agents/activity?community=garden"
        onReveal={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "See activity of Claude" }).getAttribute("href")).toBe(
      "/account/agents/activity?community=garden&agentId=00000000-0000-7000-8000-000000000001",
    );
    expect(screen.getByRole("link", { name: "Activity of Laptop" }).getAttribute("href")).toBe(
      "/account/agents/activity?community=garden&tokenId=00000000-0000-7000-8000-000000000020",
    );
  });

  it("shows no activity link without a destination", () => {
    show(agent(), false);

    expect(screen.queryByRole("link", { name: /activity of/i })).toBeNull();
  });
});

describe("agent card", () => {
  it("marks the card with the agent icon next to the name", () => {
    show(agent(), false);

    const heading = screen.getByText("Claude");
    expect(heading.parentElement?.querySelector("[data-slot='agent-avatar']")).not.toBeNull();
  });
});
