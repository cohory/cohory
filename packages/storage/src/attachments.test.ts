import { describe, expect, it } from "vitest";

import {
  attachmentMaxBytes,
  courseAgentFileKey,
  courseAttachmentKey,
  isCourseAgentFileKey,
  isCourseAttachmentKey,
  validateAttachment,
} from "./attachments";
import { contentTypeForKey } from "./content-types";
import { communityId, jpegBytes, pngBytes } from "./test/images";

const courseId = "019a0000-0000-7000-8000-000000000003";
const fileId = "019a0000-0000-7000-8000-000000000004";
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%\u00e2\u00e3\n");
const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const text = (value: string) => new TextEncoder().encode(value);

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      return error.code;
    }
  }
  return undefined;
}

describe("lesson attachment validation", () => {
  it.each([
    ["guide.pdf", pdfBytes, "application/pdf", "pdf", "application/pdf"],
    ["starter.zip", zipBytes, "application/zip", "zip", "application/zip"],
    ["diagram.PNG", pngBytes, "image/png", "png", "image/png"],
    ["photo.jpeg", jpegBytes, "image/jpeg", "jpg", "image/jpeg"],
    ["notes.md", text("# Notes"), "text/markdown", "md", "text/markdown; charset=utf-8"],
    ["notes.txt", text("plain"), "text/plain", "txt", "text/plain; charset=utf-8"],
    ["data.csv", text("a,b\n1,2"), "text/csv", "csv", "text/csv; charset=utf-8"],
  ] as const)("accepts %s", (name, bytes, declaredType, extension, contentType) => {
    expect(validateAttachment({ bytes, name, declaredType })).toEqual({
      name,
      extension,
      contentType,
      size: bytes.byteLength,
    });
  });

  it("accepts text files whatever type the browser declared", () => {
    const result = validateAttachment({
      bytes: text("a,b"),
      name: "data.csv",
      declaredType: "application/vnd.ms-excel",
    });

    expect(result.contentType).toBe("text/csv; charset=utf-8");
  });

  it.each(["script.js", "page.html", "image.svg", "binary.exe", "noextension", "archive.tar.gz"])(
    "rejects %s as an unsupported type",
    (name) => {
      expect(
        codeOf(() => validateAttachment({ bytes: text("x"), name, declaredType: "text/plain" })),
      ).toBe("unsupported_type");
    },
  );

  it("rejects a file over 25 MB", () => {
    const bytes = new Uint8Array(attachmentMaxBytes + 1);
    bytes.set(pdfBytes);

    expect(attachmentMaxBytes).toBe(25 * 1024 * 1024);
    expect(
      codeOf(() => validateAttachment({ bytes, name: "big.pdf", declaredType: "application/pdf" })),
    ).toBe("file_too_large");
  });

  it("rejects an empty file", () => {
    expect(
      codeOf(() =>
        validateAttachment({ bytes: new Uint8Array(), name: "a.txt", declaredType: "text/plain" }),
      ),
    ).toBe("unsupported_type");
  });

  it.each([
    ["fake.pdf", text("<html>"), "application/pdf"],
    ["fake.zip", pdfBytes, "application/zip"],
    ["fake.png", jpegBytes, "image/png"],
    ["binary.txt", new Uint8Array([0x61, 0x00, 0x62]), "text/plain"],
    ["latin1.csv", new Uint8Array([0x61, 0xe9, 0x62]), "text/csv"],
  ] as const)("rejects %s whose bytes do not match the extension", (name, bytes, declaredType) => {
    expect(codeOf(() => validateAttachment({ bytes, name, declaredType }))).toBe(
      "content_mismatch",
    );
  });

  it("strips folders and control characters from the display name", () => {
    const result = validateAttachment({
      bytes: pdfBytes,
      name: "C:\\Users\\me\\..\\re\u0000port\u202e.pdf",
      declaredType: "application/pdf",
    });

    expect(result.name).toBe("report.pdf");
  });

  it("caps the display name length and keeps the extension", () => {
    const result = validateAttachment({
      bytes: pdfBytes,
      name: `${"a".repeat(300)}.pdf`,
      declaredType: "application/pdf",
    });

    expect(result.name.length).toBeLessThanOrEqual(200);
    expect(result.name.endsWith(".pdf")).toBe(true);
  });
});

describe("course attachment keys", () => {
  it("lives under the community and course folders", () => {
    const key = courseAttachmentKey(communityId, courseId, fileId, "pdf");

    expect(key).toBe(`communities/${communityId}/courses/${courseId}/attachments/${fileId}.pdf`);
    expect(isCourseAttachmentKey(key, communityId, courseId)).toBe(true);
    expect(contentTypeForKey(key)).toBe("application/pdf");
  });

  it("serves zip and markdown attachments with their types", () => {
    expect(contentTypeForKey("a/b.zip")).toBe("application/zip");
    expect(contentTypeForKey("a/b.md")).toBe("text/markdown; charset=utf-8");
  });

  it.each([
    `communities/${communityId}/courses/${fileId}/attachments/${fileId}.pdf`,
    `communities/${fileId}/courses/${courseId}/attachments/${fileId}.pdf`,
    `communities/${communityId}/posts/${fileId}.png`,
    `communities/${communityId}/courses/${courseId}/attachments/${fileId}.exe`,
    `communities/${communityId}/courses/${courseId}/attachments/../x.pdf`,
  ])("rejects %s for another course, community, or type", (key) => {
    expect(isCourseAttachmentKey(key, communityId, courseId)).toBe(false);
  });
});

describe("course agent file keys", () => {
  it("lives in the agent folder of the course", () => {
    const key = courseAgentFileKey(communityId, courseId, fileId, "md");

    expect(key).toBe(`communities/${communityId}/courses/${courseId}/agent/${fileId}.md`);
    expect(isCourseAgentFileKey(key, communityId, courseId)).toBe(true);
    expect(isCourseAttachmentKey(key, communityId, courseId)).toBe(false);
  });

  it.each([
    `communities/${communityId}/courses/${courseId}/attachments/${fileId}.md`,
    `communities/${fileId}/courses/${courseId}/agent/${fileId}.md`,
    `communities/${communityId}/courses/${courseId}/agent/../${fileId}.md`,
    `communities/${communityId}/courses/${courseId}/agent/${fileId}.sh`,
  ])("rejects %s", (key) => {
    expect(isCourseAgentFileKey(key, communityId, courseId)).toBe(false);
  });
});
