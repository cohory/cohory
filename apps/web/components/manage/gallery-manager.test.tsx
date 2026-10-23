import type { GalleryItemView } from "@cohory/communities";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { removeGalleryItemAction, reorderGalleryAction } from "../../lib/manage/about-actions";
import { GalleryManager } from "./gallery-manager";

vi.mock("../../lib/manage/about-actions", () => ({
  addGalleryImageAction: vi.fn(),
  addGalleryVideoAction: vi.fn(),
  removeGalleryItemAction: vi.fn(),
  reorderGalleryAction: vi.fn(),
  updateGalleryAltTextAction: vi.fn(),
}));

const reorder = vi.mocked(reorderGalleryAction);
const remove = vi.mocked(removeGalleryItemAction);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  vi.clearAllMocks();
});

const items: GalleryItemView[] = [
  { id: "a", kind: "image", url: "/a.png", altText: null, position: 0 },
  { id: "b", kind: "image", url: "/b.png", altText: null, position: 1 },
  {
    id: "c",
    kind: "video_embed",
    provider: "youtube",
    url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    altText: null,
    position: 2,
  },
];

function reordered(ids: string[]): GalleryItemView[] {
  return ids.map((id, position) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new Error(id);
    return { ...item, position };
  });
}

async function chooseWithKeyboard(trigger: HTMLElement, name: string) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("menuitem", { name });
  option.focus();
  await act(async () => {
    fireEvent.keyDown(option, { key: "Enter" });
  });
}

describe("GalleryManager", () => {
  it("shows one Hero badge, one actions menu per row, and the video thumbnail", () => {
    render(<GalleryManager slug="studio" initial={items} />);

    expect(screen.getAllByText("Hero")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Actions for / })).toHaveLength(3);
    expect(screen.getByText("3 of 10")).toBeTruthy();
    expect(
      document.querySelector('img[src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]'),
    ).toBeTruthy();
  });

  it("moves an item up from its actions menu with the keyboard", async () => {
    reorder.mockResolvedValue({ ok: true, data: reordered(["a", "c", "b"]) });
    render(<GalleryManager slug="studio" initial={items} />);

    await chooseWithKeyboard(
      screen.getByRole("button", { name: "Actions for YouTube video 3" }),
      "Move up",
    );

    await waitFor(() => expect(reorder).toHaveBeenCalledWith("studio", ["a", "c", "b"]));
    await screen.findByRole("button", { name: "Actions for YouTube video 2" });
  });

  it("makes an item the hero from its actions menu", async () => {
    reorder.mockResolvedValue({ ok: true, data: reordered(["c", "a", "b"]) });
    render(<GalleryManager slug="studio" initial={items} />);

    await chooseWithKeyboard(
      screen.getByRole("button", { name: "Actions for YouTube video 3" }),
      "Make hero",
    );

    await waitFor(() => expect(reorder).toHaveBeenCalledWith("studio", ["c", "a", "b"]));
    const status = await screen.findByText("YouTube video 3 is now the hero.");
    expect(status.getAttribute("role")).toBe("status");
  });

  it("disables the moves that do not apply to the first item", async () => {
    render(<GalleryManager slug="studio" initial={items} />);
    const trigger = screen.getByRole("button", { name: "Actions for Image 1" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(
      (await screen.findByRole("menuitem", { name: "Move up" })).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Make hero" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "Move down" }).hasAttribute("aria-disabled")).toBe(
      false,
    );
  });

  it("keeps Add enabled and explains an empty link instead of sending it", async () => {
    render(<GalleryManager slug="studio" initial={items} />);

    const add = screen.getByRole("button", { name: "Add video" });
    expect(add).toHaveProperty("disabled", false);
    fireEvent.click(add);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Paste a YouTube, Vimeo, or Loom video link.",
    );
  });

  it("disables the add controls when the gallery is full but keeps the help readable", () => {
    const full = Array.from({ length: 10 }, (_, index): GalleryItemView => ({
      id: `i${index}`,
      kind: "image",
      url: `/i${index}.png`,
      altText: null,
      position: index,
    }));
    render(<GalleryManager slug="studio" initial={full} />);

    expect(screen.getByRole("button", { name: "Upload image" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Video link")).toHaveProperty("disabled", true);
    expect(screen.getByText("The gallery is full. Remove an item to add another.")).toBeTruthy();
    expect(screen.getByText("10 of 10")).toBeTruthy();
  });

  it("asks before removing an item and removes it only after the confirm", async () => {
    remove.mockResolvedValue({ ok: true, data: reordered(["a", "c"]) });
    render(<GalleryManager slug="studio" initial={items} />);

    await chooseWithKeyboard(screen.getByRole("button", { name: "Actions for Image 2" }), "Remove");
    const dialog = await screen.findByRole("dialog", { name: "Remove Image 2?" });
    expect(remove).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove Image 2" }));
    });

    expect(remove).toHaveBeenCalledWith("studio", "b");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
