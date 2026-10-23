import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseForm, saveFailedMessage, type CourseFormProps } from "./course-form";

vi.mock("../feed/client-helpers", () => ({ uploadPostImage: vi.fn() }));

function setup(onSubmit: CourseFormProps["onSubmit"]) {
  render(
    <CourseForm
      slug="design"
      initial={{ title: "", description: "", coverKey: null, coverUrl: null }}
      submitLabel="Create course"
      pendingLabel="Creating…"
      onSubmit={onSubmit}
    />,
  );
  return {
    title: () => screen.getByRole("textbox", { name: "Title" }),
    description: () => screen.getByRole("textbox", { name: "Short description" }),
    submit: () => screen.getByRole("button", { name: /Create course|Try again/ }),
  };
}

describe("CourseForm", () => {
  it("asks for a title on the field instead of the browser bubble", async () => {
    const onSubmit = vi.fn<CourseFormProps["onSubmit"]>();
    const form = setup(onSubmit);

    await act(async () => fireEvent.click(form.submit()));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.title().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Give your course a title.")).toBeTruthy();
    expect(document.activeElement).toBe(form.title());
  });

  it("puts a server error on the field it belongs to and focuses it", async () => {
    const form = setup(async () => ({
      message: "Use 2,000 characters or fewer for the description.",
      fieldErrors: { description: "Use 2,000 characters or fewer for the description." },
    }));
    fireEvent.change(form.title(), { target: { value: "Basics" } });

    await act(async () => fireEvent.click(form.submit()));

    expect(form.description().getAttribute("aria-invalid")).toBe("true");
    expect(form.title().getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).toBe(form.description());
  });

  it("shows a server error without a field next to the buttons", async () => {
    const form = setup(async () => ({ message: "You can't do that in this community." }));
    fireEvent.change(form.title(), { target: { value: "Basics" } });

    await act(async () => fireEvent.click(form.submit()));

    expect(screen.getByRole("alert").textContent).toBe("You can't do that in this community.");
    expect(form.title().getAttribute("aria-invalid")).toBeNull();
  });

  it("never stays stuck saving when the request fails, and keeps the typed values", async () => {
    const onSubmit = vi
      .fn<CourseFormProps["onSubmit"]>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(null);
    const form = setup(onSubmit);
    fireEvent.change(form.title(), { target: { value: "Basics" } });
    fireEvent.change(form.description(), { target: { value: "Start here" } });

    await act(async () => fireEvent.click(form.submit()));

    expect(screen.getByRole("alert").textContent).toContain(saveFailedMessage);
    expect(form.title()).toHaveProperty("value", "Basics");
    expect(form.description()).toHaveProperty("value", "Start here");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Create course" }).disabled).toBe(
      false,
    );

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));

    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("limits the title to the server's length", () => {
    const form = setup(vi.fn());

    expect(form.title().getAttribute("maxlength")).toBe("120");
  });
});

describe("CourseForm level lock", () => {
  const levels = [
    { level: 1, name: null },
    { level: 2, name: "Sprout" },
    { level: 3, name: null },
  ];

  it("lets the creator lock the course until a level", async () => {
    const onSubmit = vi.fn<CourseFormProps["onSubmit"]>(async () => null);
    render(
      <CourseForm
        slug="design"
        initial={{ title: "Glazes", description: "", coverKey: null, coverUrl: null }}
        levels={levels}
        submitLabel="Save"
        pendingLabel="Saving…"
        onSubmit={onSubmit}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Who can open it" });
    expect(screen.getByRole("option", { name: "Level 2 (Sprout) and up" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "3" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ requiredLevel: 3 }));
  });

  it("leaves the level choice out while levels are off", () => {
    setup(vi.fn<CourseFormProps["onSubmit"]>());

    expect(screen.queryByRole("combobox", { name: "Who can open it" })).toBeNull();
  });
});
