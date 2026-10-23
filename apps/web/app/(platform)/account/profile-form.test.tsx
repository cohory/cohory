import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateProfile } from "./actions";
import { ProfileForm } from "./profile-form";

vi.mock("./actions", () => ({ updateProfile: vi.fn() }));

const update = vi.mocked(updateProfile);

afterEach(() => {
  vi.clearAllMocks();
});

async function saveName(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  });
}

describe("ProfileForm", () => {
  it("keeps the typed name when the avatar is refused", async () => {
    update.mockResolvedValue({
      status: "error",
      field: "avatar",
      message: "The image is over 5 MB. Choose a smaller image.",
      name: "Rosa Park",
    });
    render(<ProfileForm name="Rosa" />);

    await saveName("Rosa Park");

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Rosa Park");
    expect(document.activeElement).toBe(screen.getByLabelText("Avatar"));
  });

  it("does not hang when the request fails, and keeps the typed name", async () => {
    update.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ProfileForm name="Rosa" />);

    await saveName("Rosa Park");

    expect(screen.getByRole("alert").textContent).toBe(
      "We couldn't save your changes. Check your connection and try again.",
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Rosa Park");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" }).disabled).toBe(
      false,
    );
  });
});
