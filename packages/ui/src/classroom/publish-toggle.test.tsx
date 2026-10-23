import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoursePublishControl, type CoursePublishControlProps } from "./publish-toggle";

function props(overrides: Partial<CoursePublishControlProps> = {}): CoursePublishControlProps {
  return {
    status: "draft",
    courseTitle: "Paid Community Playbook",
    lessonCounts: { published: 3, draft: 1 },
    memberCount: 12,
    onPublish: vi.fn(() => Promise.resolve(true)),
    onUnpublish: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function openPublish() {
  fireEvent.click(screen.getByRole("button", { name: "Publish course" }));
  return screen.getByRole("dialog");
}

describe("CoursePublishControl", () => {
  it("shows how many lessons are published next to the status", () => {
    render(<CoursePublishControl {...props()} />);

    expect(screen.getByText("3 of 4 lessons published")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("says what members will see and publishes with the chosen options", async () => {
    const onPublish = vi.fn(() => Promise.resolve(true));
    render(<CoursePublishControl {...props({ onPublish })} />);

    const dialog = openPublish();
    expect(dialog.textContent).toContain("3 lessons will be visible.");
    expect(dialog.textContent).toContain("1 lesson is still a draft.");

    fireEvent.click(screen.getByRole("checkbox", { name: "Publish draft lessons too" }));
    expect(dialog.textContent).toContain("4 lessons will be visible.");
    const announce = screen.getByRole("checkbox", { name: "Post an announcement in the feed" });
    expect((announce as HTMLInputElement).checked).toBe(false);
    fireEvent.click(announce);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(onPublish).toHaveBeenCalledExactlyOnceWith({
        publishDraftLessons: true,
        announce: true,
      }),
    );
  });

  it("blocks publishing when no lesson would be visible", () => {
    render(<CoursePublishControl {...props({ lessonCounts: { published: 0, draft: 0 } })} />);

    const dialog = openPublish();

    expect(dialog.textContent).toContain("Add a lesson before you publish the course.");
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
  });

  it("starts with draft lessons included when none is published yet", () => {
    render(<CoursePublishControl {...props({ lessonCounts: { published: 0, draft: 2 } })} />);

    openPublish();

    const drafts = screen.getByRole("checkbox", { name: "Publish draft lessons too" });
    expect((drafts as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(false);
  });

  it("confirms moving a published course to drafts with the member count", async () => {
    const onUnpublish = vi.fn(() => Promise.resolve(true));
    render(<CoursePublishControl {...props({ status: "published", onUnpublish })} />);

    fireEvent.click(screen.getByRole("button", { name: "Move to drafts" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain('Move "Paid Community Playbook" to drafts?');
    expect(dialog.textContent).toContain("12 members will no longer see this course.");
    fireEvent.click(screen.getByRole("button", { name: "Move to drafts" }));

    await waitFor(() => expect(onUnpublish).toHaveBeenCalledOnce());
  });
});
