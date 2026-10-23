import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLayerForm, agentLayerPreview } from "./agent-layer-form";
import { AgentMaterialPanel } from "./agent-material-panel";
import { emptyAgentLayer, type AgentJsonCheck, type AgentLayerFormValue } from "./agent-types";

afterEach(() => {
  vi.useRealTimers();
});

function Harness({ check, initial }: { check?: AgentJsonCheck; initial?: AgentLayerFormValue }) {
  const [value, setValue] = useState(initial ?? emptyAgentLayer);
  return (
    <>
      <AgentLayerForm value={value} onChange={setValue} onUploadFile={vi.fn()} checkJson={check} />
      <output data-testid="preview">{agentLayerPreview(value, "Lesson")}</output>
    </>
  );
}

describe("AgentLayerForm", () => {
  it("adds a task with default schemas and an evaluation for it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
      target: { value: "Write it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add evaluation" }));

    expect((screen.getByRole("textbox", { name: "Task id" }) as HTMLInputElement).value).toBe(
      "task-1",
    );
    expect(screen.getByTestId("preview").textContent).toContain("task-1: Write it");
    expect(screen.getByTestId("preview").textContent).toContain("task-1: schema");
  });

  it("flags JSON that does not parse without asking the server", () => {
    const check = vi.fn<AgentJsonCheck>();
    render(<Harness check={check} />);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const input = screen.getByRole("textbox", { name: "Input schema" });

    fireEvent.change(input, { target: { value: "{ nope" } });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/not valid JSON/)).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });

  it("shows the server's JSON Schema problem after a pause", async () => {
    vi.useFakeTimers();
    const check = vi.fn<AgentJsonCheck>(async (_kind, text) =>
      text.includes("nope") ? "This is not a valid JSON Schema." : null,
    );
    render(<Harness check={check} />);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Input schema" }), {
      target: { value: '{ "type": "nope" }' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(check).toHaveBeenCalledWith("schema", '{ "type": "nope" }');
    expect(screen.getByText("This is not a valid JSON Schema.")).toBeTruthy();
  });
});

describe("AgentMaterialPanel", () => {
  const base = {
    nextVersions: { patch: "1.0.0", minor: "1.0.0", major: "1.0.0" },
    license: { label: "Personal use by the buyer's agents only", text: "Read only." },
    versions: [],
  };

  it("cannot publish until a published lesson has material", () => {
    render(
      <AgentMaterialPanel
        {...base}
        onPublish={vi.fn()}
        lessons={[
          {
            id: "a",
            title: "Draft",
            moduleTitle: "M",
            href: "#",
            status: "draft",
            hasLayer: true,
            includedOnPublish: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("Lesson is a draft")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Publish agent version" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("publishes the first version as 1.0.0 and shows errors", async () => {
    const onPublish = vi.fn(async () => "Nothing changed since version 1.0.0.");
    render(
      <AgentMaterialPanel
        {...base}
        onPublish={onPublish}
        lessons={[
          {
            id: "a",
            title: "Ready",
            moduleTitle: "M",
            href: "#",
            status: "published",
            hasLayer: true,
            includedOnPublish: true,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish agent version" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish 1.0.0" }));
    });

    expect(
      screen.getByText("License for agents: Personal use by the buyer's agents only"),
    ).toBeTruthy();
    expect(onPublish).toHaveBeenCalledWith({ bump: "major", changelog: "" });
    expect(screen.getByText("Nothing changed since version 1.0.0.")).toBeTruthy();
  });
});
