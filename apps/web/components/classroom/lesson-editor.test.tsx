import { emptyAgentLayer } from "@cohory/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { updateLessonAction } from "../../lib/courses/actions";
import { saveFailedMessage } from "./course-form";
import { LessonEditor, type LessonEditorProps } from "./lesson-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../lib/courses/actions", () => ({ updateLessonAction: vi.fn() }));
vi.mock("../../lib/courses/agent-actions", () => ({
  checkAgentJsonAction: vi.fn(async () => null),
  draftLessonAgentLayerAction: vi.fn(),
  saveLessonAgentLayerAction: vi.fn(),
}));
vi.mock("./client-helpers", () => ({
  uploadLessonAttachment: vi.fn(),
  uploadAgentFile: vi.fn(),
}));

const updateLesson = vi.mocked(updateLessonAction);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

const lessonId = "0192d3c0-0000-7000-8000-000000000001";

function setup(overrides: Partial<LessonEditorProps> = {}) {
  const onDone = vi.fn();
  render(
    <LessonEditor
      slug="design"
      course={{ id: "c1", slug: "basics", title: "Basics", href: "/c/design/classroom/basics" }}
      lesson={{
        id: lessonId,
        slug: "intro",
        title: "Intro",
        status: "draft",
        bodyHtml: "",
        bodyMarkdown: "Welcome",
        videoUrl: null,
        attachments: [],
      }}
      agentLayer={{ initial: emptyAgentLayer, saved: false }}
      onDone={onDone}
      {...overrides}
    />,
  );
  return { onDone };
}

function selectTab(name: string) {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

const title = () => screen.getByRole("textbox", { name: "Title" });

describe("LessonEditor", () => {
  it("keeps typed agent material when switching to the lesson tab and back", () => {
    setup();

    selectTab("For agents");
    fireEvent.change(screen.getByRole("textbox", { name: "Objective" }), {
      target: { value: "Build a signup form" },
    });
    selectTab("Lesson");
    selectTab("For agents");

    expect(screen.getByRole("textbox", { name: "Objective" })).toHaveProperty(
      "value",
      "Build a signup form",
    );
  });

  it("saves with the keyboard because the lesson editor is a form", async () => {
    updateLesson.mockResolvedValue({ ok: true, data: { lessonSlug: "intro", status: "draft" } });
    setup();

    await act(async () => fireEvent.submit(title().closest("form") ?? title()));

    expect(updateLesson).toHaveBeenCalledOnce();
    expect(updateLesson.mock.calls[0]?.[0]).toMatchObject({ publish: false });
  });

  it("shows a draft lesson's status and publishes it from the editor", async () => {
    updateLesson.mockResolvedValue({
      ok: true,
      data: { lessonSlug: "intro", status: "published" },
    });
    const { onDone } = setup();

    expect(screen.getByText("Draft")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish" })));

    expect(updateLesson).toHaveBeenCalledOnce();
    expect(updateLesson.mock.calls[0]?.[0]).toMatchObject({ lessonId, publish: true });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("offers a plain Save for a published lesson", () => {
    setup({
      lesson: {
        id: lessonId,
        slug: "intro",
        title: "Intro",
        status: "published",
        bodyHtml: "",
        bodyMarkdown: "Welcome",
        videoUrl: null,
        attachments: [],
      },
    });

    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("asks before Cancel throws away changes", () => {
    const { onDone } = setup();
    fireEvent.change(title(), { target: { value: "Intro, revised" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("closes right away on Cancel when nothing changed", () => {
    const { onDone } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDone).toHaveBeenCalledOnce();
  });

  it("never stays stuck saving when the request fails, and keeps the typed text", async () => {
    updateLesson.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    setup();
    fireEvent.change(title(), { target: { value: "Intro, revised" } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save draft" })));

    expect(screen.getByRole("alert").textContent).toContain(saveFailedMessage);
    expect(title()).toHaveProperty("value", "Intro, revised");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save draft" }).disabled).toBe(
      false,
    );
  });

  it("puts a server error on the field and moves focus there", async () => {
    updateLesson.mockResolvedValue({
      ok: false,
      message: "Use a YouTube, Vimeo, Loom, or Wistia link.",
      fieldErrors: { videoUrl: "Use a YouTube, Vimeo, Loom, or Wistia link." },
    });
    setup();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save draft" })));

    const video = screen.getByRole("textbox", { name: "Video link" });
    expect(video.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(video);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for a title on the field", async () => {
    setup();
    fireEvent.change(title(), { target: { value: "  " } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save draft" })));

    expect(updateLesson).not.toHaveBeenCalled();
    expect(screen.getByText("Give your lesson a title.")).toBeTruthy();
    expect(document.activeElement).toBe(title());
  });

  it("offers to restore lesson changes saved on this device", () => {
    window.localStorage.setItem(
      `cohory:draft:lesson:${lessonId}`,
      JSON.stringify({
        savedAt: "2026-10-22T10:42:00.000Z",
        value: { title: "Intro", bodyMarkdown: "Welcome, and more", videoUrl: "", attachments: [] },
      }),
    );
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Restore changes" }));

    expect(screen.getByRole("textbox", { name: "Lesson content" })).toHaveProperty(
      "value",
      "Welcome, and more",
    );
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});

describe("LessonEditor writing tools", () => {
  it("keeps Save and Publish off while the video link is not supported", async () => {
    setup();

    fireEvent.change(screen.getByRole("textbox", { name: "Video link" }), {
      target: { value: "https://example.com/v.mp4" },
    });

    expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    await act(async () => fireEvent.submit(title().closest("form") ?? title()));
    expect(updateLesson).not.toHaveBeenCalled();
  });

  it("previews with the member renderer and without a repeated title", () => {
    setup();

    fireEvent.change(screen.getByRole("textbox", { name: "Lesson content" }), {
      target: { value: "# Intro\n\n**Hello** <script>x</script>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(preview.querySelector("h1")).toBeNull();
    expect(preview.querySelector("strong")?.textContent).toBe("Hello");
    expect(preview.querySelector("script")).toBeNull();
  });

  it("flags image links that members will not see", () => {
    setup();

    fireEvent.change(screen.getByRole("textbox", { name: "Lesson content" }), {
      target: { value: "![Pricing diagram](https://cdn.other.test/p.png)" },
    });

    expect(screen.getByRole("status", { name: "Images that won't show" }).textContent).toContain(
      "https://cdn.other.test/p.png",
    );
  });
});
