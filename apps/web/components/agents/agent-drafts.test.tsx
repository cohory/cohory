import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { discardDraftAction } from "../../lib/agents/actions";
import { AgentDrafts, type DraftItem } from "./agent-drafts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/agents/actions", () => ({
  discardDraftAction: vi.fn(),
  publishDraftAction: vi.fn(),
}));

const discard = vi.mocked(discardDraftAction);

afterEach(() => {
  vi.clearAllMocks();
});

const draft: DraftItem = {
  id: "00000000-0000-7000-8000-000000000001",
  title: "Weekly recap",
  excerpt: "Here is what happened this week.",
  authorName: "Ada",
  agentName: "Course helper",
  categoryName: null,
  createdAt: "2026-10-21T10:00:00.000Z",
};

describe("AgentDrafts", () => {
  it("asks before discarding a draft and discards it only after the confirm", async () => {
    discard.mockResolvedValue({ ok: true, data: null });
    render(<AgentDrafts slug="garden" drafts={[draft]} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard this draft?" });
    expect(discard).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Discard draft" }));
    });

    expect(discard).toHaveBeenCalledWith({ slug: "garden", draftId: draft.id });
  });
});
