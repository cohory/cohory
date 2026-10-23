import { availableScopes, memberAgentScopes, type Scope } from "@cohory/authz";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { presetsFor, ScopePicker } from "./scope-picker";

function Harness({
  available,
  initial = [],
  audience = "staff",
}: {
  available: readonly Scope[];
  initial?: Scope[];
  audience?: "staff" | "member";
}) {
  const [value, setValue] = useState<Scope[]>(initial);
  return (
    <>
      <ScopePicker
        idPrefix="t"
        value={value}
        onChange={setValue}
        available={available}
        audience={audience}
      />
      <output data-testid="value">{value.join(" ")}</output>
    </>
  );
}

describe("ScopePicker", () => {
  it("shows a moderator only permissions a moderator can use", () => {
    render(<Harness available={availableScopes("moderator", "token")} />);
    expect(screen.queryByRole("checkbox", { name: "Read payments" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Manage webhooks" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Propose changes" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Read notifications" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Moderate members" })).toBeTruthy();
    expect(screen.getByText("Only permissions that work for your role are shown.")).toBeTruthy();
  });

  it("gives each permission its plain label as the accessible name", () => {
    render(<Harness available={availableScopes("owner", "token")} />);
    const box = screen.getByRole("checkbox", { name: "Read the community" });
    expect(box.getAttribute("aria-describedby")).toBe("t-community-read-description");
  });

  it("keeps staff only permissions under More permissions", () => {
    render(<Harness available={availableScopes("owner", "agent")} />);
    const more = screen.getByText("More permissions (7)").closest("details");
    expect(more?.open).toBe(false);
    expect(more?.textContent).toContain("Read payments");
    expect(more?.textContent).toContain("Export members");
    expect(more?.textContent).toContain("Sensitive");
  });

  it("applies a preset and switches to Custom after a manual change", () => {
    render(<Harness available={availableScopes("owner", "agent")} />);
    fireEvent.click(screen.getByRole("radio", { name: "Write drafts" }));
    expect(screen.getByTestId("value").textContent).toBe(
      "community:read posts:read comments:read posts:write comments:write courses:read events:read",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Read events" }));
    expect((screen.getByRole("radio", { name: "Custom" }) as HTMLInputElement).checked).toBe(true);
  });

  it("opens More permissions when a preset uses one of them", () => {
    render(<Harness available={availableScopes("owner", "agent")} />);
    fireEvent.click(screen.getByRole("radio", { name: "Moderation helper" }));
    expect(screen.getByText("More permissions (7)").closest("details")?.open).toBe(true);
    expect(screen.getByTestId("value").textContent).toContain("members:moderate");
  });

  it("tells a member where purchase requests wait", () => {
    render(<Harness available={[...memberAgentScopes]} audience="member" />);
    expect(screen.getByText(/Requests wait for you in Account, Agents/)).toBeTruthy();
    expect(screen.queryByText("More permissions", { exact: false })).toBeNull();
  });

  it("offers no moderation preset without moderation", () => {
    expect(presetsFor(availableScopes("member", "token")).map((preset) => preset.id)).toEqual([
      "read",
      "drafts",
    ]);
  });
});
