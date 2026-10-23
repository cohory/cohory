import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonPlayer, type LessonPlayerProps } from "./lesson-player";

function props(overrides: Partial<LessonPlayerProps> = {}): LessonPlayerProps {
  return {
    lesson: {
      title: "Setup",
      videoUrl: "https://acme.wistia.com/medias/abc123def4",
      bodyHtml: "<h2>Install</h2><ul><li>Step one</li></ul><pre><code>pnpm i</code></pre>",
      attachments: [
        {
          name: "Checklist.pdf",
          href: "/files/checklist.pdf",
          size: 1536,
          contentType: "application/pdf",
        },
      ],
    },
    completed: false,
    onToggleComplete: vi.fn(),
    previousHref: "/l/welcome",
    nextHref: "/l/habits",
    onNavigate: vi.fn(),
    sidebar: <p>Outline</p>,
    locale: "en-US",
    ...overrides,
  };
}

describe("LessonPlayer", () => {
  it("renders title, body, attachments, and a click-to-load video", () => {
    render(<LessonPlayer {...props()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Setup" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Install" })).toBeTruthy();
    expect(screen.getByText("pnpm i")).toBeTruthy();
    const file = screen.getByRole("link", { name: /Checklist.pdf/ });
    expect(file.getAttribute("href")).toBe("/files/checklist.pdf");
    expect(file.textContent).toContain("1.5 KB");
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Play Wistia video" }));
    expect(document.querySelector("iframe")?.getAttribute("src")).toContain(
      "https://fast.wistia.net/embed/iframe/abc123def4",
    );
  });

  it("shows an inline error for unsupported video links", () => {
    render(
      <LessonPlayer
        {...props({ lesson: { ...props().lesson, videoUrl: "https://example.com/v.mp4" } })}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
  });

  it("toggles completion with the button and reflects the completed state", () => {
    const onToggleComplete = vi.fn();
    const { rerender } = render(<LessonPlayer {...props({ onToggleComplete })} />);

    const button = screen.getByRole("button", { name: "Mark complete" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggleComplete).toHaveBeenCalledOnce();

    rerender(<LessonPlayer {...props({ onToggleComplete, completed: true })} />);
    expect(screen.getByRole("button", { name: "Completed" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("disables the button while an async toggle is pending", async () => {
    let resolve = () => {};
    const onToggleComplete = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    render(<LessonPlayer {...props({ onToggleComplete })} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(screen.getByRole("button", { name: "Mark complete" })).toHaveProperty("disabled", true);
    await act(async () => resolve());
    expect(screen.getByRole("button", { name: "Mark complete" })).toHaveProperty("disabled", false);
  });

  it("supports arrow keys for previous and next and m for completion", () => {
    const onNavigate = vi.fn();
    const onToggleComplete = vi.fn();
    render(<LessonPlayer {...props({ onNavigate, onToggleComplete })} />);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "m" });

    expect(onNavigate.mock.calls).toEqual([["/l/welcome"], ["/l/habits"]]);
    expect(onToggleComplete).toHaveBeenCalledOnce();
  });

  it("ignores shortcuts while typing or with modifiers, and without targets", () => {
    const onNavigate = vi.fn();
    const onToggleComplete = vi.fn();
    render(
      <>
        <input aria-label="Search" />
        <LessonPlayer {...props({ onNavigate, onToggleComplete, previousHref: null })} />
      </>,
    );

    const input = screen.getByRole("textbox", { name: "Search" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "m" });
    fireEvent.keyDown(document.body, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggleComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
  });

  it("shows the sidebar by default on wide screens with CSS, not after hydration", () => {
    render(<LessonPlayer {...props()} />);

    const sidebar = screen.getByRole("complementary", { name: "Lessons" });
    expect(sidebar.textContent).toBe("Outline");
    expect(sidebar.className).toContain("hidden");
    expect(sidebar.className).toContain("md:block");
  });

  it("follows the reader's explicit sidebar choice", () => {
    render(<LessonPlayer {...props()} />);

    const toggle = screen.getByRole("button", { name: /Show lessons/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    const opened = screen.getByRole("button", { name: "Hide lessons" });
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("complementary", { name: "Lessons" }).className).not.toContain(
      "hidden",
    );

    fireEvent.click(opened);
    expect(screen.getByRole("button", { name: "Show lessons" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("puts the lessons toggle after the title so phones keep a full width title", () => {
    render(<LessonPlayer {...props()} />);

    const title = screen.getByRole("heading", { level: 1, name: "Setup" });
    const toggle = screen.getByRole("button", { name: /Show lessons/ });
    expect(title.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the lesson position and course progress next to the title", () => {
    render(<LessonPlayer {...props({ progress: { position: 2, total: 10, percent: 20 } })} />);

    expect(screen.getByText("Lesson 2 of 10, 20% complete")).toBeTruthy();
  });

  it("shows only the position when progress is not tracked", () => {
    render(<LessonPlayer {...props({ progress: { position: 1, total: 3, percent: null } })} />);

    expect(screen.getByText("Lesson 1 of 3")).toBeTruthy();
  });

  it("shows a completion panel on the last lesson once the course is complete", () => {
    const finish = {
      courseTitle: "Basics",
      nextCourse: { title: "Advanced", href: "/c/a/classroom/advanced" },
      classroomHref: "/c/a/classroom",
      calendarHref: "/c/a/calendar",
      shareHref: "/c/a",
    };
    const { rerender } = render(<LessonPlayer {...props({ nextHref: null, finish })} />);
    expect(screen.queryByRole("region", { name: "You finished Basics" })).toBeNull();

    rerender(<LessonPlayer {...props({ nextHref: null, completed: true, finish })} />);
    const panel = screen.getByRole("region", { name: "You finished Basics" });
    expect(panel.querySelector('a[href="/c/a/classroom/advanced"]')?.textContent).toContain(
      "Start Advanced",
    );
    expect(panel.querySelector('a[href="/c/a"]')?.textContent).toContain("Share your progress");
    expect(panel.querySelector('a[href="/c/a/calendar"]')?.textContent).toContain(
      "See upcoming live calls",
    );
  });

  it("names the next live call in the completion panel when there is one", () => {
    render(
      <LessonPlayer
        {...props({
          nextHref: null,
          completed: true,
          finish: {
            courseTitle: "Basics",
            classroomHref: "/c/a/classroom",
            calendarHref: "/c/a/calendar",
            nextLiveCall: {
              title: "Office hours",
              when: "Tuesday 3 November, 17:00 GMT",
              href: "/c/a/calendar/office-hours/o1",
            },
          },
        })}
      />,
    );

    const panel = screen.getByRole("region", { name: "You finished Basics" });
    expect(panel.querySelector('a[href="/c/a/calendar/office-hours/o1"]')?.textContent).toBe(
      "Next live call: Office hours, Tuesday 3 November, 17:00 GMT",
    );
    expect(panel.querySelector('a[href="/c/a/calendar"]')).toBeNull();
  });

  it("offers the Classroom when there is no next course", () => {
    render(
      <LessonPlayer
        {...props({
          nextHref: null,
          completed: true,
          finish: { courseTitle: "Basics", classroomHref: "/c/a/classroom" },
        })}
      />,
    );

    const panel = screen.getByRole("region", { name: "You finished Basics" });
    expect(panel.querySelector('a[href="/c/a/classroom"]')?.textContent).toContain(
      "Back to Classroom",
    );
  });
});
