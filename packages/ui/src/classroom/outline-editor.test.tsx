import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { editorModules } from "./fixtures.test-utils";
import { OutlineEditor, type OutlineEditorProps } from "./outline-editor";

function props(overrides: Partial<OutlineEditorProps> = {}): OutlineEditorProps {
  return {
    modules: editorModules(),
    onAddModule: vi.fn(() => Promise.resolve(null)),
    onRenameModule: vi.fn(),
    onDeleteModule: vi.fn(),
    onAddLesson: vi.fn(() => Promise.resolve(true)),
    onReorder: vi.fn(),
    ...overrides,
  };
}

function lessonTitles() {
  const list = screen.getByRole("list", { name: "Lessons in Getting started" });
  return Array.from(list.querySelectorAll(":scope > li")).map(
    (item) => item.querySelector("span")?.textContent,
  );
}

function live() {
  return document.querySelector("[data-slot='outline-editor-announcer']")?.textContent;
}

describe("OutlineEditor keyboard reordering", () => {
  it("picks up with Space, moves with arrows, drops with Space, and announces each step", () => {
    const onReorder = vi.fn();
    render(<OutlineEditor {...props({ onReorder })} />);
    const handle = screen.getByRole("button", { name: "Reorder Alpha" });
    handle.focus();

    fireEvent.keyDown(handle, { key: " " });
    expect(handle.getAttribute("aria-pressed")).toBe("true");
    expect(live()).toBe(
      "Picked up Alpha. Position 1 of 3. Use the arrow keys to move, Space to drop, Escape to cancel.",
    );

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(live()).toBe("Alpha moved to position 2 of 3.");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), { key: "ArrowDown" });
    expect(live()).toBe("Alpha moved to position 3 of 3.");
    expect(lessonTitles()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reorder Alpha" }));
    expect(onReorder).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), { key: " " });
    expect(onReorder).toHaveBeenCalledExactlyOnceWith("m1", ["b", "c", "a"]);
    expect(live()).toBe("Alpha dropped at position 3 of 3.");
  });

  it("cancels with Escape and restores the original order", () => {
    const onReorder = vi.fn();
    render(<OutlineEditor {...props({ onReorder })} />);
    const handle = screen.getByRole("button", { name: "Reorder Charlie" });

    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(lessonTitles()).toEqual(["Alpha", "Charlie", "Bravo"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Charlie" }), { key: "Escape" });

    expect(lessonTitles()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(live()).toBe("Reorder cancelled. Charlie returned to position 3 of 3.");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("reorders modules with a null module id and skips unchanged drops", () => {
    const onReorder = vi.fn();
    render(<OutlineEditor {...props({ onReorder })} />);
    const handle = screen.getByRole("button", { name: "Reorder Going further" });

    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(live()).toBe("Going further is already at position 2 of 2.");
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onReorder).not.toHaveBeenCalled();

    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Going further" }), { key: " " });
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(null, ["m2", "m1"]);
  });
});

describe("OutlineEditor actions", () => {
  it("adds lessons from an inline title row and keeps focus there for the next one", async () => {
    const onAddLesson = vi.fn(() => Promise.resolve(true));
    render(<OutlineEditor {...props({ onAddLesson })} />);

    fireEvent.click(screen.getByRole("button", { name: "Add lesson to Going further" }));
    const input = screen.getByRole("textbox", { name: "New lesson title in Going further" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Pricing your community" } });
    fireEvent.submit(input);

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    expect(onAddLesson).toHaveBeenCalledExactlyOnceWith("m2", "Pricing your community");
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New lesson title in Going further" })).toBeNull();
  });

  it("keeps the typed title when adding a lesson fails", async () => {
    const onAddLesson = vi.fn(() => Promise.resolve(false));
    render(<OutlineEditor {...props({ onAddLesson })} />);

    fireEvent.click(screen.getByRole("button", { name: "Add lesson to Going further" }));
    const input = screen.getByRole("textbox", { name: "New lesson title in Going further" });
    fireEvent.change(input, { target: { value: "Launch day" } });
    fireEvent.submit(input);

    await waitFor(() => expect(onAddLesson).toHaveBeenCalledOnce());
    expect((input as HTMLInputElement).value).toBe("Launch day");
  });

  it("creates one module per click and opens its title for editing", async () => {
    let resolve: (id: string | null) => void = () => undefined;
    const onAddModule = vi.fn(
      () =>
        new Promise<string | null>((done) => {
          resolve = done;
        }),
    );
    const { rerender } = render(<OutlineEditor {...props({ onAddModule })} />);

    const button = screen.getByRole("button", { name: "Add module" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onAddModule).toHaveBeenCalledOnce();
    expect(button.hasAttribute("disabled")).toBe(true);

    await act(async () => resolve("m3"));
    rerender(
      <OutlineEditor
        {...props({
          onAddModule,
          modules: [...editorModules(), { id: "m3", title: "Module 3", lessons: [] }],
        })}
      />,
    );
    const title = screen.getByRole("textbox", { name: "Module title" });
    expect((title as HTMLInputElement).value).toBe("Module 3");
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("renames a module inline", () => {
    const onRenameModule = vi.fn();
    render(<OutlineEditor {...props({ onRenameModule })} />);

    fireEvent.click(screen.getByRole("button", { name: "Getting started" }));
    const input = screen.getByRole("textbox", { name: "Module title" });
    fireEvent.change(input, { target: { value: "Start here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRenameModule).toHaveBeenCalledWith("m1", "Start here");
    expect(screen.getByText("No lessons in this module yet.")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("offers edit, duplicate, publish, move, and delete for each lesson", async () => {
    const onEditLesson = vi.fn();
    const onDuplicateLesson = vi.fn();
    const onSetLessonPublished = vi.fn();
    const onMoveLesson = vi.fn();
    const onDeleteLesson = vi.fn();
    render(
      <OutlineEditor
        {...props({
          onEditLesson,
          onDuplicateLesson,
          onSetLessonPublished,
          onMoveLesson,
          onDeleteLesson,
        })}
      />,
    );

    async function choose(lesson: string, item: string) {
      const trigger = screen.getByRole("button", { name: `Actions for ${lesson}` });
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: item }));
    }

    await choose("Charlie", "Edit lesson");
    await choose("Charlie", "Duplicate as draft");
    await choose("Charlie", "Publish lesson");
    await choose("Alpha", "Move to drafts");
    await choose("Alpha", "Move to Going further");
    await choose("Alpha", "Delete lesson");

    expect(onEditLesson).toHaveBeenCalledWith("c");
    expect(onDuplicateLesson).toHaveBeenCalledWith("c");
    expect(onSetLessonPublished).toHaveBeenNthCalledWith(1, "c", true);
    expect(onSetLessonPublished).toHaveBeenNthCalledWith(2, "a", false);
    expect(onMoveLesson).toHaveBeenCalledWith("a", "m2");
    expect(onDeleteLesson).toHaveBeenCalledWith("a");
  });

  it("keeps focus on the moved lesson when the outline updates after a keyboard drop", () => {
    const { rerender } = render(<OutlineEditor {...props()} />);
    const handle = screen.getByRole("button", { name: "Reorder Charlie" });
    handle.focus();
    fireEvent.keyDown(handle, { key: " " });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Charlie" }), { key: " " });

    (document.activeElement as HTMLElement | null)?.blur();
    const [first, ...rest] = editorModules();
    const lessons = first?.lessons ?? [];
    rerender(
      <OutlineEditor
        {...props({
          modules: [
            {
              id: "m1",
              title: "Getting started",
              lessons: [lessons[2], lessons[0], lessons[1]].flatMap((l) => (l ? [l] : [])),
            },
            ...rest,
          ],
        })}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reorder Charlie" }));
    expect(live()).toBe("Charlie dropped at position 1 of 3.");
  });

  it("shows an empty state", () => {
    const onAddModule = vi.fn(() => Promise.resolve(null));
    render(<OutlineEditor {...props({ modules: [], onAddModule })} />);

    expect(screen.getByText("No modules yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    expect(onAddModule).toHaveBeenCalledOnce();
  });
});
