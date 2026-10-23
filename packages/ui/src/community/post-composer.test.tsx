import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostComposer } from "./post-composer";

afterEach(() => {
  window.localStorage.clear();
});

const draftKey = "cohory:draft:post:design";

function storeDraft(value: unknown) {
  window.localStorage.setItem(
    draftKey,
    JSON.stringify({ savedAt: "2026-10-22T10:42:00.000Z", value }),
  );
}

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

describe("PostComposer", () => {
  it("expands from the collapsed field with Enter and focuses the body", () => {
    setup();

    expect(screen.queryByRole("textbox")).toBeNull();
    expand();
    expect(document.activeElement).toBe(body());
    expect(screen.getByRole("textbox", { name: "Title (optional)" })).toBeTruthy();
  });

  it("opens expanded with the body focused when asked to start a post", () => {
    setup({ defaultExpanded: true });

    expect(document.activeElement).toBe(body());
  });

  it("expands on click", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Write something" }));
    expect(body()).toBeTruthy();
  });

  it("disables Post while empty and enables it with text", () => {
    setup();
    expand();

    expect(postButton().disabled).toBe(true);
    fireEvent.change(body(), { target: { value: "   " } });
    expect(postButton().disabled).toBe(true);
    fireEvent.change(body(), { target: { value: "Hello" } });
    expect(postButton().disabled).toBe(false);
  });

  it("disables Post over the character limit", () => {
    setup({ maxLength: 5 });
    expand();

    fireEvent.change(body(), { target: { value: "Too long" } });
    expect(postButton().disabled).toBe(true);
    expect(screen.getByText("3 characters over the limit").className).toContain("tabular-nums");
  });

  it("disables Post while an image is uploading", async () => {
    let finish: (value: { key: string; url: string }) => void = () => undefined;
    const { onUploadImage } = setup();
    onUploadImage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    expand();
    fireEvent.change(body(), { target: { value: "With photo" } });

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input missing");
    const file = new File(["x"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(postButton().disabled).toBe(true);
    await act(async () => finish({ key: "k1", url: "https://cdn.test/k1.png" }));
    expect(postButton().disabled).toBe(false);
    expect(screen.getByRole("img", { name: "Image 1: photo.png" }).getAttribute("src")).toBe(
      "https://cdn.test/k1.png",
    );
  });

  it("submits a composed document with resolved mentions and embeds, then collapses", async () => {
    const { onSubmit } = setup({
      onResolveMention: async (name) => (name === "ana" ? { userId: "u1", label: "Ana" } : null),
    });
    onSubmit.mockResolvedValue(undefined);
    expand();
    fireEvent.change(screen.getByRole("textbox", { name: "Title (optional)" }), {
      target: { value: " Hello " },
    });
    fireEvent.change(body(), {
      target: { value: "Hi @ana **welcome**\n\nhttps://youtu.be/dQw4w9WgXcQ" },
    });
    expect(screen.getByText("YouTube video")).toBeTruthy();

    await act(async () => fireEvent.click(postButton()));

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Hello",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hi " },
              { type: "mention", userId: "u1", label: "Ana" },
              { type: "text", text: " " },
              { type: "text", text: "welcome", marks: ["bold"] },
            ],
          },
          { type: "embed", provider: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
        ],
      },
      categoryId: null,
      scheduledAt: null,
      emailMembers: false,
    });
    expect(screen.getByRole("button", { name: "Write something" })).toBeTruthy();
  });

  it("submits the chosen category and resets to the default", async () => {
    const { onSubmit } = setup({
      categories: [
        { id: "c1", name: "General" },
        { id: "c2", name: "Introductions" },
      ],
      defaultCategoryId: "c1",
    });
    onSubmit.mockResolvedValue(undefined);
    expand();
    const category = screen.getByRole("combobox", { name: "Category" });
    expect((category as HTMLSelectElement).value).toBe("c1");
    fireEvent.change(category, { target: { value: "c2" } });
    fireEvent.change(body(), { target: { value: "Hello there" } });

    await act(async () => fireEvent.click(postButton()));

    expect(onSubmit.mock.calls[0]?.[0].categoryId).toBe("c2");
    expand();
    expect((screen.getByRole("combobox", { name: "Category" }) as HTMLSelectElement).value).toBe(
      "c1",
    );
  });

  it("hides the category field when the community has no categories", () => {
    setup();
    expand();
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
  });

  it("keeps the draft when submitting fails", async () => {
    const { onSubmit } = setup({ error: "We couldn't publish your post. Try again." });
    onSubmit.mockRejectedValue(new Error("network"));
    expand();
    fireEvent.change(body(), { target: { value: "Keep me" } });

    await act(async () => fireEvent.click(postButton()));

    expect(body().value).toBe("Keep me");
    expect(screen.getByRole("alert").textContent).toBe("We couldn't publish your post. Try again.");
  });

  it("cancels with Escape when empty and returns focus to the collapsed field", () => {
    const onCancel = vi.fn();
    setup({ onCancel });
    expand();

    fireEvent.keyDown(body(), { key: "Escape" });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Write something" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("asks before discarding content on Escape", () => {
    setup();
    expand();
    fireEvent.change(body(), { target: { value: "Draft" } });

    fireEvent.keyDown(body(), { key: "Escape" });
    expect(screen.getByRole("group", { name: "Discard this post?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the disabled reason instead of the composer", () => {
    setup({ canPost: false, disabledReason: "Only admins can post here." });

    expect(screen.getByText("Only admins can post here.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers no schedule control unless scheduling is allowed", () => {
    setup();
    expand();
    expect(screen.queryByRole("button", { name: "Schedule for later" })).toBeNull();
  });

  it("schedules for a local date and time and names the time zone", async () => {
    const { onSubmit } = setup({ allowSchedule: true });
    expand();
    fireEvent.change(body(), { target: { value: "Monday notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule for later" }));
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(screen.getByText(zone, { exact: false })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Publish on"), {
      target: { value: "2026-11-02T09:30" },
    });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Schedule" })));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: new Date(2026, 10, 2, 9, 30).toISOString() }),
    );
  });

  it("goes back to posting now when the schedule is removed", () => {
    setup({ allowSchedule: true });
    expand();
    fireEvent.change(body(), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule for later" }));
    fireEvent.click(screen.getByRole("button", { name: "Post now instead" }));
    expect(postButton().disabled).toBe(false);
  });

  it("limits the title to the server's 120 characters", () => {
    setup();
    expand();

    expect(
      screen.getByRole("textbox", { name: "Title (optional)" }).getAttribute("maxlength"),
    ).toBe("120");
  });

  it("keeps the action bar above the phone tab bar", () => {
    setup();
    expand();

    const bar = postButton().closest("[data-slot=post-composer-actions]");
    expect(bar?.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(bar?.className).toContain("md:static");
  });

  it("offers to restore a post draft saved on this device", () => {
    storeDraft({ title: "Weekly wins", text: "Share one win", categoryId: "", scheduleLocal: "" });
    setup({ draftKey });

    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));

    expect(body().value).toBe("Share one win");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Title (optional)" }).value).toBe(
      "Weekly wins",
    );
    expect(screen.queryByRole("button", { name: "Restore draft" })).toBeNull();
  });

  it("forgets a post draft the person discards", () => {
    storeDraft({ title: "", text: "Old idea", categoryId: "", scheduleLocal: "" });
    setup({ draftKey });

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

    expect(screen.queryByRole("button", { name: "Restore draft" })).toBeNull();
    expect(window.localStorage.getItem(draftKey)).toBeNull();
  });

  it("removes the saved draft after posting", async () => {
    storeDraft({ title: "", text: "Ready to post", categoryId: "", scheduleLocal: "" });
    setup({ draftKey });
    fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));

    await act(async () => fireEvent.click(postButton()));

    expect(window.localStorage.getItem(draftKey)).toBeNull();
  });

  it("says the network failed and keeps the text when posting throws without a message", async () => {
    const { onSubmit } = setup();
    onSubmit.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expand();
    fireEvent.change(body(), { target: { value: "Keep me" } });

    await act(async () => fireEvent.click(postButton()));

    expect(body().value).toBe("Keep me");
    expect(screen.getByRole("alert").textContent).toBe(
      "We couldn't reach the server. Check your connection and try again.",
    );
    expect(postButton().disabled).toBe(false);

    onSubmit.mockResolvedValueOnce(undefined);
    await act(async () => fireEvent.click(postButton()));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
