import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeneralForm } from "./general-form";

const save = vi.hoisted(() =>
  vi.fn<
    (input: { slug: string; name: string; privacy: string }) => Promise<{ ok: true; data: null }>
  >(),
);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/manage/actions", () => ({ saveGeneralAction: save }));

afterEach(() => {
  save.mockReset();
});

function renderForm(privacy: "private" | "public") {
  save.mockResolvedValue({ ok: true, data: null });
  render(<GeneralForm slug="lab" initial={{ name: "Lab", privacy }} />);
}

describe("GeneralForm", () => {
  it("asks before leaving the page with an unsaved name", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderForm("private");
    const link = document.body.appendChild(document.createElement("a"));
    link.href = "/c/lab";
    link.textContent = "Feed";

    fireEvent.click(link);
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Community name"), { target: { value: "Lab two" } });
    fireEvent.click(link);
    expect(confirm).toHaveBeenCalledOnce();
    link.remove();
    confirm.mockRestore();
  });

  it("saves a name change without asking", async () => {
    renderForm("private");
    fireEvent.change(screen.getByLabelText("Community name"), { target: { value: "Lab two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before making a private community public and says what becomes readable", async () => {
    renderForm("private");
    fireEvent.click(screen.getByRole("radio", { name: /^Public/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByRole("heading", { name: "Make Lab public?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/Anyone can read every post and comment, including older/);
    expect(dialog.textContent).toMatch(/names show next to their posts/);
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Make public" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ slug: "lab", name: "Lab", privacy: "public" }),
    );
  });

  it("asks before making a public community private and says shared links will ask to sign in", async () => {
    renderForm("public");
    fireEvent.click(screen.getByRole("radio", { name: /^Private/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByRole("heading", { name: "Make Lab private?" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/ask people to sign in/);
    expect(save).not.toHaveBeenCalled();
  });
});
