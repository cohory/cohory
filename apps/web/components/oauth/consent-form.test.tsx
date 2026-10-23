import { availableScopes } from "@cohory/authz";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveConnectionAction } from "../../lib/oauth/actions";
import { ConsentForm, type ConsentCommunityItem } from "./consent-form";

vi.mock("../../lib/oauth/actions", () => ({
  approveConnectionAction: vi.fn(),
  cancelConnectionAction: vi.fn(),
}));

const approve = vi.mocked(approveConnectionAction);

afterEach(() => {
  vi.clearAllMocks();
});

const owner = availableScopes("owner", "agent");

function community(overrides: Partial<ConsentCommunityItem> = {}): ConsentCommunityItem {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    name: "Review Lab",
    logoUrl: null,
    agents: [],
    available: owner,
    preferredAgentId: null,
    ...overrides,
  };
}

function renderForm(communities: ConsentCommunityItem[]) {
  render(
    <ConsentForm
      params={{ client_id: "x" }}
      clientName="Desk Assistant"
      redirectHost="127.0.0.1:47999"
      communities={communities}
      requested={["community:read", "posts:read", "posts:write"]}
      preselected={["community:read", "posts:read"]}
    />,
  );
}

describe("ConsentForm", () => {
  it("lists what the app can and cannot do in plain words, with one Allow button", () => {
    renderForm([community()]);
    expect(screen.getByText("It can: read the community, read posts.")).toBeTruthy();
    expect(
      screen.getByText("It also asked to: write posts. These stay off unless you turn them on."),
    ).toBeTruthy();
    expect(screen.getByText(/^It cannot: write comments, read members/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow access to Review Lab" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("Change permissions").closest("details")?.open).toBe(false);
    expect(
      screen.getByText(
        "Access renews while you use it. Disconnect any time in Account, Connected apps.",
      ),
    ).toBeTruthy();
  });

  it("preselects the agent this app used last time when reconnecting", async () => {
    approve.mockResolvedValue({ ok: true, data: { url: "http://127.0.0.1/cb" } });
    const agent = {
      id: "00000000-0000-7000-8000-0000000000aa",
      name: "Desk agent",
      scopes: ["community:read" as const],
    };
    renderForm([community({ agents: [agent], preferredAgentId: agent.id })]);
    const reuse = screen.getByRole("radio", { name: "Use one of your agents" });
    expect((reuse as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getByText(/Desk Assistant at 127.0.0.1:47999 used this agent last time/),
    ).toBeTruthy();
    expect(screen.getByText("It can: read the community.")).toBeTruthy();
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "Allow access to Review Lab" }));
    await waitFor(() => expect(approve).toHaveBeenCalled());
    expect(approve.mock.calls[0]?.[0]).toMatchObject({
      agent: { kind: "existing", agentId: agent.id },
      scopes: ["community:read"],
    });
  });

  it("warns when a new agent would repeat the name of one the person has", () => {
    const agent = {
      id: "00000000-0000-7000-8000-0000000000bb",
      name: "Desk Assistant",
      scopes: ["community:read" as const],
    };
    renderForm([community({ agents: [agent] })]);
    expect(screen.getByText(/You already have an agent with this name here/)).toBeTruthy();
  });
});
