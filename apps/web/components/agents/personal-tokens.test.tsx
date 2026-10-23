import { availableScopes } from "@cohory/authz";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createPersonalTokenAction, regeneratePersonalTokenAction } from "../../lib/agents/actions";
import { PersonalTokens, type PersonalTokenItem } from "./personal-tokens";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/agents/actions", () => ({
  createPersonalTokenAction: vi.fn(),
  regeneratePersonalTokenAction: vi.fn(),
  revokePersonalTokenAction: vi.fn(),
}));

const create = vi.mocked(createPersonalTokenAction);
const regenerate = vi.mocked(regeneratePersonalTokenAction);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

const now = "2026-10-22T12:00:00.000Z";

function token(overrides: Partial<PersonalTokenItem>): PersonalTokenItem {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    name: "Nightly sync",
    prefix: "cohory_abcde",
    scopes: ["posts:read", "posts:write"],
    state: "active",
    communityName: "Makers",
    communitySlug: "makers",
    expiresAt: "2026-12-30T12:00:00.000Z",
    lastUsedAt: null,
    lastUsedVia: null,
    ...overrides,
  };
}

const communities = [{ id: "c1", name: "Makers", available: availableScopes("member", "token") }];

describe("PersonalTokens", () => {
  it("lists active tokens first and folds revoked and expired ones", () => {
    render(
      <PersonalTokens
        now={now}
        communities={communities}
        tokens={[
          token({ id: "a", name: "Live one" }),
          token({ id: "b", name: "Old one", state: "revoked" }),
          token({ id: "c", name: "Lapsed one", state: "expired" }),
        ]}
      />,
    );
    const folded = screen.getByText("Revoked and expired (2)").closest("details");
    expect(folded?.open).toBe(false);
    expect(within(folded as HTMLElement).getByText("Old one")).toBeTruthy();
    expect(within(folded as HTMLElement).getByText("Lapsed one")).toBeTruthy();
  });

  it("shows plain permission labels and how a token was last used", () => {
    render(
      <PersonalTokens
        now={now}
        communities={communities}
        tokens={[token({ lastUsedAt: "2026-10-22T11:48:00.000Z", lastUsedVia: "mcp" })]}
      />,
    );
    const list = within(screen.getByRole("region", { name: "Your tokens" }));
    expect(list.getByText("Read posts")).toBeTruthy();
    expect(list.getByText("Write posts")).toBeTruthy();
    expect(list.queryByText(/posts:read/)).toBeNull();
    expect(list.getByText(/via MCP/)).toBeTruthy();
  });

  it("warns 7 days before expiry and shows the regenerated token in a dialog", async () => {
    regenerate.mockResolvedValue({
      ok: true,
      data: { token: "cohory_new_secret_value", prefix: "cohory_new_s", slug: "makers" },
    });
    render(
      <PersonalTokens
        now={now}
        communities={communities}
        tokens={[token({ expiresAt: "2026-10-27T12:00:00.000Z" })]}
      />,
    );
    expect(screen.getByText("Expires in 5 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate token" }));
    await waitFor(() =>
      expect(screen.getByTestId("new-token").textContent).toBe("cohory_new_secret_value"),
    );
    expect(regenerate).toHaveBeenCalledWith("00000000-0000-7000-8000-000000000001");
    expect(screen.getByRole("dialog", { name: "Copy your new token now" })).toBeTruthy();
    expect(screen.getByText(/\/mcp$/)).toBeTruthy();
  });

  it("keeps the create form inactive while the new token is on screen", async () => {
    create.mockResolvedValue({
      ok: true,
      data: { token: "cohory_fresh_secret", prefix: "cohory_fresh", slug: "makers" },
    });
    render(<PersonalTokens now={now} communities={communities} tokens={[]} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Script" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() =>
      expect(screen.getByTestId("new-token").textContent).toBe("cohory_fresh_secret"),
    );
    const submit = await screen.findByRole("button", { name: "Create token", hidden: true });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "I stored it" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Create token" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});
