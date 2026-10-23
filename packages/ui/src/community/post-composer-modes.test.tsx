import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostComposer } from "./post-composer";

afterEach(() => {
  window.localStorage.clear();
});

function setup(overrides: Partial<Parameters<typeof PostComposer>[0]> = {}) {
  const onSubmit = vi.fn<Parameters<typeof PostComposer>[0]["onSubmit"]>();
  const onUploadImage = vi.fn<Parameters<typeof PostComposer>[0]["onUploadImage"]>();
  render(<PostComposer onSubmit={onSubmit} onUploadImage={onUploadImage} {...overrides} />);
  return { onSubmit, onUploadImage };
}

function expand() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Write something" }), { key: "Enter" });
}

function body(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Write something" });
}

function postButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Post" });
}

describe("PostComposer scheduling presets", () => {
  it("fills tomorrow at 09:00 and never offers a past time", () => {
    setup({ allowSchedule: true });
    expand();
    fireEvent.change(body(), { target: { value: "Notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule for later" }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow 09:00" }));

    const field = screen.getByLabelText<HTMLInputElement>("Publish on");
    expect(field.value).toMatch(/T09:00$/);
    expect(field.min).not.toBe("");
    expect(screen.getByRole("button", { name: "Monday 09:00" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
  });
});

describe("PostComposer member email", () => {
  const status = { lastSentAt: null, nextAvailableAt: null };

  it("only shows the member email option when the viewer may use it", () => {
    setup();
    expand();
    expect(screen.queryByRole("checkbox", { name: "Also email all members" })).toBeNull();
  });

  it("submits the email choice with the post", async () => {
    const { onSubmit } = setup({ memberEmail: status });
    expand();
    fireEvent.change(body(), { target: { value: "Big news" } });
    expect(screen.getByText("Not used yet.", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Also email all members" }));

    await act(async () => fireEvent.click(postButton()));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ emailMembers: true }));
  });

  it("turns the option off while scheduling and while the daily email is used", () => {
    setup({ allowSchedule: true, memberEmail: status });
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Schedule for later" }));
    const box = screen.getByRole<HTMLInputElement>("checkbox", { name: "Also email all members" });
    expect(box.disabled).toBe(true);
    cleanup();

    setup({
      memberEmail: {
        lastSentAt: new Date(Date.now() - 60_000),
        nextAvailableAt: new Date(Date.now() + 60_000),
      },
    });
    expand();
    const used = screen.getByRole<HTMLInputElement>("checkbox", { name: "Also email all members" });
    expect(used.disabled).toBe(true);
    expect(screen.getByText(/Last used/)).toBeTruthy();
  });
});

describe("PostComposer images from the clipboard and drops", () => {
  it("adds a pasted image to the post", () => {
    const { onUploadImage } = setup();
    onUploadImage.mockReturnValue(new Promise(() => undefined));
    expand();
    const file = new File(["x"], "paste.png", { type: "image/png" });

    fireEvent.paste(body(), { clipboardData: { files: [file] } });

    expect(onUploadImage).toHaveBeenCalledWith(file);
  });

  it("adds a dropped image and ignores other files", () => {
    const { onUploadImage } = setup();
    onUploadImage.mockReturnValue(new Promise(() => undefined));
    expand();
    const image = new File(["x"], "drop.png", { type: "image/png" });
    const text = new File(["x"], "notes.txt", { type: "text/plain" });

    fireEvent.drop(screen.getByRole("group", { name: "New post" }), {
      dataTransfer: { files: [image, text], types: ["Files"] },
    });

    expect(onUploadImage).toHaveBeenCalledTimes(1);
    expect(onUploadImage).toHaveBeenCalledWith(image);
  });
});

describe("PostComposer mentions", () => {
  it("suggests members after @ and inserts the picked name", async () => {
    vi.useFakeTimers();
    try {
      const onSearchMentions = vi.fn(async () => [
        { userId: "u1", label: "Ana Lopez", avatarUrl: null },
      ]);
      setup({ onSearchMentions });
      expand();
      fireEvent.change(body(), { target: { value: "Hi @An", selectionStart: 6 } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(onSearchMentions).toHaveBeenCalledWith("An");
      const option = screen.getByRole("option", { name: "Ana Lopez" });
      fireEvent.mouseDown(option);
      expect(body().value).toBe("Hi @AnaLopez ");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a mention that matches no member", async () => {
    vi.useFakeTimers();
    try {
      setup({
        onResolveMention: (name) => (name === "ana" ? { userId: "u1", label: "Ana" } : null),
      });
      expand();
      fireEvent.change(body(), { target: { value: "Hi @ana and @nobody" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(screen.getByText(/No member found for @nobody\./)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PostComposer edit mode", () => {
  it("opens with the scheduled post's text, category, time, and images", async () => {
    const { onSubmit } = setup({
      label: "Edit scheduled post",
      submitLabel: "Save changes",
      categories: [{ id: "c1", name: "Wins" }],
      initial: {
        title: "Plan",
        text: "Draft body",
        categoryId: "c1",
        scheduledAt: new Date(2026, 10, 2, 9, 0).toISOString(),
        images: [{ key: "k1", url: "https://cdn.test/k1.png" }],
      },
    });

    const group = screen.getByRole("group", { name: "Edit scheduled post" });
    expect(group).toBeTruthy();
    expect(body().value).toBe("Draft body");
    expect(screen.getByLabelText<HTMLInputElement>("Publish on").value).toBe("2026-11-02T09:00");
    expect(screen.queryByRole("button", { name: "Post now instead" })).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "" } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Plan",
        categoryId: null,
        scheduledAt: new Date(2026, 10, 2, 9, 0).toISOString(),
        document: expect.objectContaining({
          content: expect.arrayContaining([expect.objectContaining({ type: "image", key: "k1" })]),
        }),
      }),
    );
  });
});
