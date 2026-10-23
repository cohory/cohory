import { emptyAgentLayer } from "@cohory/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveLessonAgentLayerAction } from "../../lib/courses/agent-actions";
import { LessonAgentEditor } from "./lesson-agent-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/courses/agent-actions", () => ({
  checkAgentJsonAction: vi.fn(),
  draftLessonAgentLayerAction: vi.fn(),
  saveLessonAgentLayerAction: vi.fn(),
}));
vi.mock("./client-helpers", () => ({ uploadAgentFile: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("LessonAgentEditor", () => {
  it("keeps Save agent material enabled and asks for the objective on the field", async () => {
    render(
      <LessonAgentEditor
        slug="garden"
        courseId="00000000-0000-7000-8000-000000000001"
        lesson={{ id: "00000000-0000-7000-8000-000000000002", title: "Soil" }}
        value={emptyAgentLayer}
        onChange={vi.fn()}
        onSaved={vi.fn()}
        saved={false}
        onClose={vi.fn()}
      />,
    );

    const save = screen.getByRole("button", { name: "Save agent material" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });

    expect(saveLessonAgentLayerAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Objective").getAttribute("aria-invalid")).toBe("true");
  });
});
