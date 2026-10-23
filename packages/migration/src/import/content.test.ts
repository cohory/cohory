import { describe, expect, it } from "vitest";

import { importContent, rewriteStorageKey, type ContentRewrite } from "./content";

const source = "0199f0a0-0000-7000-8000-00000000000a";
const target = "0199f0a0-0000-7000-8000-00000000000b";
const oldCourse = "0199f0a0-0000-7000-8000-0000000000c1";
const newCourse = "0199f0a0-0000-7000-8000-0000000000c2";
const oldUser = "0199f0a0-0000-7000-8000-0000000000d1";
const newUser = "0199f0a0-0000-7000-8000-0000000000d2";

const keys = {
  sourceCommunityId: source,
  targetCommunityId: target,
  courseId: (id: string) => (id === oldCourse ? newCourse : undefined),
};

const rewrite: ContentRewrite = {
  key: (key) => rewriteStorageKey(key, keys),
  user: (id) => (id === oldUser ? newUser : undefined),
};

const options = { allowImages: true, imageUrl: (key: string) => `/api/uploads/${key}` };

function doc(...content: unknown[]) {
  return { type: "doc", content };
}

describe("rewriteStorageKey", () => {
  it("moves a key to the new community and course", () => {
    const attachment = `communities/${source}/courses/${oldCourse}/attachments/0199f0a0-0000-7000-8000-0000000000e1.pdf`;

    expect(rewriteStorageKey(attachment, keys)).toBe(
      `communities/${target}/courses/${newCourse}/attachments/0199f0a0-0000-7000-8000-0000000000e1.pdf`,
    );
  });

  it("refuses keys outside the source community", () => {
    expect(rewriteStorageKey("users/x/avatar.png", keys)).toBeNull();
    expect(rewriteStorageKey(`communities/${target}/posts/a.png`, keys)).toBeNull();
  });
});

describe("importContent", () => {
  it("rewrites mentions and image keys and renders through the post pipeline", () => {
    const result = importContent(
      doc(
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: oldUser, label: "ada" } }],
        },
        { type: "image", attrs: { key: `communities/${source}/posts/a.png` } },
      ),
      rewrite,
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.content.body)).toContain(newUser);
    expect(result.content.bodyHtml).toContain(`/api/uploads/communities/${target}/posts/a.png`);
  });

  it("turns a mention of someone outside the archive into plain text", () => {
    const result = importContent(
      doc({
        type: "paragraph",
        content: [{ type: "mention", attrs: { id: newCourse, label: "ghost" } }],
      }),
      rewrite,
      options,
    );

    expect(result.ok && result.content.bodyText).toBe("@ghost");
  });

  it("escapes markup in text instead of trusting the archive", () => {
    const result = importContent(
      doc({ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }),
      rewrite,
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.bodyHtml).not.toContain("<script>");
    expect(result.content.bodyHtml).toContain("&lt;script&gt;");
  });

  it("refuses unsafe links", () => {
    const result = importContent(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      }),
      rewrite,
      options,
    );

    expect(result.ok).toBe(false);
  });

  it("reports nodes the content format does not allow", () => {
    const result = importContent(doc({ type: "html", value: "<b>x</b>" }), rewrite, options);

    expect(result.ok).toBe(false);
  });

  it("reports content nested too deeply without recursing forever", () => {
    let node: unknown = { type: "text", text: "x" };
    for (let depth = 0; depth < 200; depth += 1) {
      node = { type: "blockquote", content: [node] };
    }

    expect(importContent(doc(node), rewrite, options)).toEqual({
      ok: false,
      reason: "The content is nested too deeply.",
    });
  });
});
