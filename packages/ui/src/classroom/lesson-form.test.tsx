import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LessonForm, type LessonFormProps, type LessonFormValue } from "./lesson-form";
import { PublishToggle } from "./publish-toggle";
import type { LessonAttachment } from "./types";

const empty: LessonFormValue = { title: "", bodyMarkdown: "", videoUrl: "", attachments: [] };

function Harness(props: Partial<LessonFormProps> & { initial?: LessonFormValue }) {
  const [value, setValue] = useState(props.initial ?? empty);
  return (
    <LessonForm
      value={value}
      onChange={setValue}
      onUploadAttachment={props.onUploadAttachment ?? vi.fn()}
      errors={props.errors}
      maxAttachments={props.maxAttachments}
      onUploadImage={props.onUploadImage}
      renderPreview={props.renderPreview}
      blockedImages={props.blockedImages}
      locale="en-US"
    />
  );
}

describe("LessonForm", () => {
  it("limits the title to the server's length and counts down near the end", () => {
    render(<Harness initial={{ ...empty, title: "a".repeat(105) }} />);

    const title = screen.getByRole("textbox", { name: "Title" });
    expect(title.getAttribute("maxlength")).toBe("120");
    expect(screen.getByText("15 characters left")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Lesson content" }).getAttribute("maxlength")).toBe(
      "100000",
    );
  });

  it("shows no counter while the title is short", () => {
    render(<Harness initial={{ ...empty, title: "Intro" }} />);

    expect(screen.queryByText(/characters left/)).toBeNull();
  });

  it("edits title and markdown in plain fields", () => {
    render(<Harness errors={{ title: "Add a title." }} />);

    const title = screen.getByRole("textbox", { name: "Title" });
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Add a title.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Lesson content" }), {
      target: { value: "# Hello" },
    });
    expect(
      (screen.getByRole("textbox", { name: "Lesson content" }) as HTMLTextAreaElement).value,
    ).toBe("# Hello");
  });

  it("validates the video link inline", () => {
    render(<Harness />);
    const video = screen.getByRole("textbox", { name: "Video link" });

    fireEvent.change(video, { target: { value: "https://example.com/v.mp4" } });
    expect(video.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/This link isn't supported/)).toBeTruthy();

    fireEvent.change(video, { target: { value: "https://www.loom.com/share/abcdef123456" } });
    expect(video.getAttribute("aria-invalid")).toBeNull();
  });

  it("uploads, lists, and removes attachments", async () => {
    const uploaded: LessonAttachment = {
      id: "f1",
      name: "notes.pdf",
      href: "/files/notes.pdf",
      size: 2048,
      contentType: "application/pdf",
    };
    const onUploadAttachment = vi.fn(async () => uploaded);
    render(<Harness onUploadAttachment={onUploadAttachment} />);

    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Attachment files"), { target: { files: [file] } });
    });

    expect(onUploadAttachment).toHaveBeenCalledWith(file);
    expect(screen.getByText("notes.pdf")).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.pdf" }));
    expect(screen.queryByText("notes.pdf")).toBeNull();
  });

  it("rejects files over the limit and reports failed uploads", async () => {
    const onUploadAttachment = vi.fn(async () => {
      throw new Error("nope");
    });
    render(<Harness onUploadAttachment={onUploadAttachment} />);
    const input = screen.getByLabelText("Attachment files");

    const big = new File(["x"], "big.zip", { type: "application/zip" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } });
    });
    expect(screen.getByText("big.zip is larger than 25 MB.")).toBeTruthy();
    expect(onUploadAttachment).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "a.txt")] } });
    });
    expect(screen.getByText("Couldn't upload a.txt. Try again.")).toBeTruthy();
  });
});

describe("LessonForm writing tools", () => {
  function body(): HTMLTextAreaElement {
    const field = screen.getByRole("textbox", { name: "Lesson content" });
    if (!(field instanceof HTMLTextAreaElement)) throw new Error("expected a textarea");
    return field;
  }

  it("previews the lesson with the renderer it is given", () => {
    const renderPreview = vi.fn((markdown: string) => `<p>rendered ${markdown}</p>`);
    render(<Harness initial={{ ...empty, bodyMarkdown: "hi" }} renderPreview={renderPreview} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(preview.innerHTML).toContain("<p>rendered hi</p>");
    expect(screen.getByRole("button", { name: "Preview" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("formats the selected text from the toolbar", () => {
    render(<Harness initial={{ ...empty, bodyMarkdown: "say hello" }} />);
    body().setSelectionRange(4, 9);

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(body().value).toBe("say **hello**");
  });

  it("uploads an image from the toolbar and inserts it into the lesson", async () => {
    const onUploadImage = vi.fn(async () => ({ src: "/api/uploads/c/posts/a.png" }));
    render(<Harness onUploadImage={onUploadImage} />);

    const file = new File(["x"], "pricing-diagram.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [file] } });
    });

    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(body().value).toBe("![pricing diagram](/api/uploads/c/posts/a.png)\n\n");
  });

  it("uploads pasted images", async () => {
    const onUploadImage = vi.fn(async () => ({ src: "/api/uploads/c/posts/b.png" }));
    render(<Harness onUploadImage={onUploadImage} />);

    const file = new File(["x"], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(body(), { clipboardData: { files: [file] } });
    });

    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(body().value).toContain("![shot](/api/uploads/c/posts/b.png)");
  });

  it("rejects files that are not images or are too large before uploading", async () => {
    const onUploadImage = vi.fn(async () => ({ src: "/x.png" }));
    render(<Harness onUploadImage={onUploadImage} />);
    const input = screen.getByLabelText("Image file");

    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] },
      });
    });
    expect(screen.getByText("a.pdf isn't an image. Use PNG, JPEG, GIF, or WebP.")).toBeTruthy();

    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } });
    });
    expect(screen.getByText("big.png is larger than 10 MB.")).toBeTruthy();
    expect(onUploadImage).not.toHaveBeenCalled();
  });

  it("warns about image links members will not see", () => {
    render(<Harness blockedImages={["https://cdn.other.test/a.png"]} />);

    const warning = screen.getByRole("status", { name: "Images that won't show" });
    expect(warning.textContent).toContain("https://cdn.other.test/a.png");
    expect(warning.textContent).toContain("Upload it with Add image");
  });

  it("previews a supported video link under the field", () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole("textbox", { name: "Video link" }), {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(screen.getByRole("button", { name: "Play YouTube video" })).toBeTruthy();
  });
});

describe("PublishToggle", () => {
  it("labels both states and calls publish and unpublish", () => {
    const onPublish = vi.fn();
    const onUnpublish = vi.fn();
    const { rerender } = render(
      <PublishToggle status="draft" onPublish={onPublish} onUnpublish={onUnpublish} />,
    );

    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Published")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Published" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onPublish).toHaveBeenCalledOnce();

    rerender(<PublishToggle status="published" onPublish={onPublish} onUnpublish={onUnpublish} />);
    fireEvent.click(screen.getByRole("switch", { name: "Published" }));
    expect(onUnpublish).toHaveBeenCalledOnce();
  });
});
