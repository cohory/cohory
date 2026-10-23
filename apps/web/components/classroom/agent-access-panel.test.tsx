import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { CourseAgentPanelData } from "../../lib/entitlements/load";
import {
  AgentAccessPanel,
  agentsLink,
  formattedPayload,
  lessonTitle,
  taskTitle,
} from "./agent-access-panel";

const save = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/entitlements/actions", () => ({
  saveAgentAccessAction: (input: unknown) => save(input),
  delegateCourseAction: vi.fn(),
  changeDelegationAction: vi.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  save.mockReset();
});

function data(overrides: Partial<CourseAgentPanelData> = {}): CourseAgentPanelData {
  return {
    courseId: "00000000-0000-7000-8000-000000000001",
    allowAgentAccess: false,
    license: { id: "personal_agents", label: "Personal", summary: "Personal use", text: null },
    canManage: true,
    canDelegate: false,
    agents: [],
    delegations: [],
    submissions: [],
    summary: null,
    ...overrides,
  };
}

describe("agent access switch", () => {
  it("saves as soon as the creator flips it", async () => {
    save.mockResolvedValue({ ok: true, data: null });
    render(<AgentAccessPanel slug="garden" courseSlug="playbook" data={data()} />);

    fireEvent.click(screen.getByRole("switch", { name: "Allow agent access" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toMatchObject({ allowAgentAccess: true });
  });

  it("flips back when the save fails", async () => {
    save.mockResolvedValue({ ok: false, message: "Could not save." });
    render(<AgentAccessPanel slug="garden" courseSlug="playbook" data={data()} />);

    fireEvent.click(screen.getByRole("switch", { name: "Allow agent access" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Allow agent access" }).getAttribute("aria-checked"),
    ).toBe("false");
  });
});

describe("readable agent results", () => {
  it("names tasks and lessons in words", () => {
    expect(taskTitle("write-release_checklist")).toBe("Write release checklist");
    expect(lessonTitle({ l1: "Welcome" }, "l1")).toBe("Welcome");
    expect(lessonTitle({}, "l2")).toBe("A lesson you cannot see now");
  });

  it("formats a JSON payload and keeps other text as it is", () => {
    expect(formattedPayload('{"ok":true}')).toBe('{\n  "ok": true\n}');
    expect(formattedPayload('{"cut":…')).toBe('{"cut":…');
  });

  it("sends the member to Account, Agents with a way back to the course", () => {
    expect(agentsLink("garden", "playbook")).toBe(
      "/account/agents?community=garden&return=%2Fc%2Fgarden%2Fclassroom%2Fplaybook",
    );
  });
});
