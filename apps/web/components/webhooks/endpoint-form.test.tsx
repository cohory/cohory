import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EndpointForm } from "./endpoint-form";

describe("EndpointForm", () => {
  it("keeps Add endpoint enabled without events and says to pick one on submit", async () => {
    const onSubmit = vi.fn();
    render(
      <EndpointForm
        label="Add endpoint"
        initial={{ url: "https://hooks.example.com/a", description: "", eventTypes: [] }}
        submitLabel="Add endpoint"
        pendingLabel="Adding endpoint…"
        disabled={false}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByRole("button", { name: "Add endpoint" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submit);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Pick at least one event to send.");
  });
});
