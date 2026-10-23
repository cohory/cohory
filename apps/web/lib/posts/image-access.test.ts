import { describe, expect, it, vi } from "vitest";

import {
  attachmentFilename,
  classifyUploadKey,
  contentDisposition,
  resolveImageAccess,
  type Viewer,
} from "./image-access";

const publicCommunity = "0192f2a4-0000-7000-8000-000000000001";
const privateCommunity = "0192f2a4-0000-7000-8000-000000000002";
const member = "0192f2a4-0000-7000-8000-0000000000aa";
const outsider = "0192f2a4-0000-7000-8000-0000000000bb";
const course = "0192f2a4-0000-7000-8000-0000000000c1";
const draftCourse = "0192f2a4-0000-7000-8000-0000000000c2";
const fileId = "0192f2a4-0000-7000-8000-0000000000f1";

function deps(viewer: Viewer) {
  const canReadPosts = vi.fn(async (who: Viewer, communityId: string) => {
    if (communityId === publicCommunity) return true;
    return communityId === privateCommunity && who.kind === "user" && who.userId === member;
  });
  const attachmentFor = vi.fn(async (who: Viewer, communityId: string, key: string) => {
    if (who.kind !== "user" || who.userId !== member || !key.includes(`/courses/${course}/`)) {
      return null;
    }
    return communityId === publicCommunity || communityId === privateCommunity
      ? { name: 'Week 1 "notes".pdf' }
      : null;
  });
  const currentViewer = vi.fn(async () => viewer);
  return { canReadPosts, attachmentFor, currentViewer };
}

const postImage = (communityId: string) => `communities/${communityId}/posts/0192f2a4-1.png`;
const attachment = (communityId: string, courseId = course, extension = "pdf") =>
  `communities/${communityId}/courses/${courseId}/attachments/${fileId}.${extension}`;

describe("classifyUploadKey", () => {
  it("recognizes avatars, post images, and rejects other keys", () => {
    expect(classifyUploadKey(`users/${member}/avatar.png`).kind).toBe("avatar");
    expect(classifyUploadKey(postImage(publicCommunity))).toMatchObject({
      kind: "post-image",
      communityId: publicCommunity,
    });
    expect(classifyUploadKey(`communities/${publicCommunity}/covers/a.png`).kind).toBe("unknown");
    expect(classifyUploadKey(`communities/${publicCommunity}/posts/../x.png`).kind).toBe("unknown");
    expect(classifyUploadKey("communities/not-a-uuid/posts/a.png").kind).toBe("unknown");
  });

  it("recognizes course attachments and rejects other course paths", () => {
    expect(classifyUploadKey(attachment(privateCommunity))).toEqual({
      kind: "course-attachment",
      key: attachment(privateCommunity),
      communityId: privateCommunity,
      courseId: course,
      extension: "pdf",
    });
    expect(classifyUploadKey(attachment(privateCommunity, course, "exe")).kind).toBe("unknown");
    expect(
      classifyUploadKey(`communities/${privateCommunity}/courses/${course}/covers/a.png`).kind,
    ).toBe("unknown");
    expect(
      classifyUploadKey(`communities/${privateCommunity}/courses/${course}/attachments/a.pdf`).kind,
    ).toBe("unknown");
  });
});

describe("resolveImageAccess", () => {
  it("serves avatars publicly without looking up a session", async () => {
    const d = deps({ kind: "guest" });
    await expect(resolveImageAccess(`users/${member}/avatar.webp`, d)).resolves.toMatchObject({
      kind: "public",
    });
    expect(d.currentViewer).not.toHaveBeenCalled();
  });

  it("serves a public community's image to a guest without a session", async () => {
    const d = deps({ kind: "guest" });
    await expect(resolveImageAccess(postImage(publicCommunity), d)).resolves.toMatchObject({
      kind: "public",
    });
    expect(d.currentViewer).not.toHaveBeenCalled();
  });

  it("serves a private community's image to a member with a private cache", async () => {
    const d = deps({ kind: "user", userId: member });
    await expect(resolveImageAccess(postImage(privateCommunity), d)).resolves.toMatchObject({
      kind: "members",
    });
  });

  it("denies a private community's image to a signed in non member", async () => {
    const d = deps({ kind: "user", userId: outsider });
    await expect(resolveImageAccess(postImage(privateCommunity), d)).resolves.toEqual({
      kind: "denied",
    });
  });

  it("denies a private community's image to a guest", async () => {
    const d = deps({ kind: "guest" });
    await expect(resolveImageAccess(postImage(privateCommunity), d)).resolves.toEqual({
      kind: "denied",
    });
  });

  it("denies unknown keys without any lookup", async () => {
    const d = deps({ kind: "user", userId: member });
    await expect(resolveImageAccess("secrets/key.png", d)).resolves.toEqual({ kind: "denied" });
    expect(d.canReadPosts).not.toHaveBeenCalled();
  });

  it("serves a course attachment to a member as a download named by the stored name", async () => {
    const d = deps({ kind: "user", userId: member });
    await expect(resolveImageAccess(attachment(privateCommunity), d)).resolves.toEqual({
      kind: "attachment",
      key: attachment(privateCommunity),
      extension: "pdf",
      filename: "Week 1 notes.pdf",
    });
    expect(d.canReadPosts).not.toHaveBeenCalled();
  });

  it("prefers the stored name over an old ?name= link", async () => {
    const d = deps({ kind: "user", userId: member });
    await expect(
      resolveImageAccess(attachment(privateCommunity), d, { requestedName: "other.pdf" }),
    ).resolves.toMatchObject({ filename: "Week 1 notes.pdf" });
  });

  it("falls back to the ?name= of an old link when the stored name is unusable", async () => {
    const d = deps({ kind: "user", userId: member });
    d.attachmentFor.mockResolvedValueOnce({ name: "" });
    await expect(
      resolveImageAccess(attachment(privateCommunity), d, { requestedName: "Old link.pdf" }),
    ).resolves.toMatchObject({ filename: "Old link.pdf" });

    d.attachmentFor.mockResolvedValueOnce({ name: "" });
    await expect(
      resolveImageAccess(attachment(privateCommunity), d, { requestedName: "evil.exe" }),
    ).resolves.toMatchObject({ filename: "attachment.pdf" });
  });

  it("never lets ?name= open an attachment the viewer cannot read", async () => {
    const d = deps({ kind: "user", userId: outsider });
    await expect(
      resolveImageAccess(attachment(privateCommunity), d, { requestedName: "x.pdf" }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("denies an attachment in a public community to guests and non members", async () => {
    const guest = deps({ kind: "guest" });
    await expect(resolveImageAccess(attachment(publicCommunity), guest)).resolves.toEqual({
      kind: "denied",
    });
    expect(guest.attachmentFor).not.toHaveBeenCalled();
    const stranger = deps({ kind: "user", userId: outsider });
    await expect(resolveImageAccess(attachment(publicCommunity), stranger)).resolves.toEqual({
      kind: "denied",
    });
  });

  it("denies an attachment that no visible lesson holds", async () => {
    const d = deps({ kind: "user", userId: member });
    await expect(resolveImageAccess(attachment(privateCommunity, draftCourse), d)).resolves.toEqual(
      { kind: "denied" },
    );
  });

  it("keeps post images on the post rules even for course members", async () => {
    const d = deps({ kind: "user", userId: outsider });
    await expect(resolveImageAccess(postImage(privateCommunity), d)).resolves.toEqual({
      kind: "denied",
    });
    expect(d.attachmentFor).not.toHaveBeenCalled();
  });
});

describe("branding images", () => {
  const brandingKey = (kind: string, extension = "png") =>
    `communities/${privateCommunity}/branding/${kind}-${fileId}.${extension}`;

  it("classifies community logos and covers as branding", () => {
    expect(classifyUploadKey(brandingKey("logo")).kind).toBe("branding");
    expect(classifyUploadKey(brandingKey("cover", "webp")).kind).toBe("branding");
    expect(classifyUploadKey(brandingKey("banner")).kind).toBe("unknown");
    expect(classifyUploadKey(brandingKey("logo", "svg")).kind).toBe("unknown");
  });

  it("classifies resized covers and gallery images and their width variants as branding", () => {
    const gallery = `communities/${privateCommunity}/gallery/${fileId}`;
    expect(classifyUploadKey(brandingKey("cover", "sized.jpg")).kind).toBe("branding");
    expect(classifyUploadKey(brandingKey("cover", "w640.webp")).kind).toBe("branding");
    expect(classifyUploadKey(`${gallery}.sized.png`).kind).toBe("branding");
    expect(classifyUploadKey(`${gallery}.w160.webp`).kind).toBe("branding");
    expect(classifyUploadKey(`${gallery}.w500.webp`).kind).toBe("unknown");
    expect(classifyUploadKey(`${gallery}.w640.png`).kind).toBe("unknown");
  });

  it("serves About gallery images publicly, even for a private community", async () => {
    const galleryKey = `communities/${privateCommunity}/gallery/${fileId}.jpg`;
    expect(classifyUploadKey(galleryKey).kind).toBe("branding");
    expect(classifyUploadKey(`communities/${privateCommunity}/gallery/x.jpg`).kind).toBe("unknown");
    await expect(resolveImageAccess(galleryKey, deps({ kind: "guest" }))).resolves.toEqual({
      kind: "public",
      key: galleryKey,
      immutable: true,
    });
  });

  it("serves branding publicly and immutably, even for a private community, without a session", async () => {
    const d = deps({ kind: "guest" });
    await expect(resolveImageAccess(brandingKey("cover"), d)).resolves.toEqual({
      kind: "public",
      key: brandingKey("cover"),
      immutable: true,
    });
    expect(d.currentViewer).not.toHaveBeenCalled();
    expect(d.canReadPosts).not.toHaveBeenCalled();
  });
});

describe("attachment downloads", () => {
  it("keeps a requested name that matches the stored extension", () => {
    expect(attachmentFilename("Week 1 notes.pdf", "pdf")).toBe("Week 1 notes.pdf");
  });

  it("falls back when the name is missing, unsafe, or claims another type", () => {
    expect(attachmentFilename(null, "pdf")).toBe("attachment.pdf");
    expect(attachmentFilename("evil.html", "pdf")).toBe("attachment.pdf");
    expect(attachmentFilename(".pdf", "pdf")).toBe("attachment.pdf");
    expect(attachmentFilename('a"b\\/c\r\n.pdf', "pdf")).toBe("abc.pdf");
  });

  it("writes an ascii fallback and an encoded utf-8 name", () => {
    expect(contentDisposition("Übung (1).pdf")).toBe(
      "attachment; filename=\"_bung (1).pdf\"; filename*=UTF-8''%C3%9Cbung%20%281%29.pdf",
    );
  });
});
