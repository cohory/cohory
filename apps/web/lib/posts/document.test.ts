import { parseContent } from "@cohory/posts";
import { composeDocument, type PostDocument } from "@cohory/ui";
import { describe, expect, it } from "vitest";

import { documentImages, documentToText, toContentDocument, toPostDocument } from "./document";
import { pickMention, searchMentionCandidates } from "./mentions";

const ana = { userId: "0192f2a4-0000-7000-8000-0000000000aa", label: "Ana Lopez" };
const image = {
  key: "communities/0192f2a4-0000-7000-8000-000000000001/posts/a.png",
  url: "/api/uploads/communities/0192f2a4-0000-7000-8000-000000000001/posts/a.png",
};

function compose(text: string): PostDocument {
  return composeDocument(text, [image], [], {
    resolveMention: (name) => (name === "AnaLopez" ? ana : null),
  });
}

describe("post document conversion", () => {
  it("produces a document the posts service accepts", () => {
    const doc = compose(
      "Hello **bold** and *soft* @AnaLopez\nsecond line\n\n- one\n- two\n\nhttps://youtu.be/dQw4w9WgXcQ",
    );
    expect(() => parseContent(toContentDocument(doc), { allowImages: true })).not.toThrow();
  });

  it("round trips text, marks, mentions, lists, images, and embeds", () => {
    const doc = compose("Hello **bold** @AnaLopez https://example.com\n\n- one\n- two");
    const back = toPostDocument(toContentDocument(doc), [image]);
    expect(back).toEqual(doc);
  });

  it("drops images whose url is unknown", () => {
    const doc = toPostDocument(toContentDocument(compose("Hi")), []);
    expect(documentImages(doc)).toEqual([]);
  });

  it("turns a document back into editable text", () => {
    const doc = compose("Hello **bold** @AnaLopez\n\n- one\n- two");
    expect(documentToText(doc)).toBe("Hello **bold** @AnaLopez\n\n- one\n- two");
    expect(documentImages(doc)).toEqual([image]);
  });
});

describe("mention lookup", () => {
  const members = [
    { userId: "1", name: "Ana Lopez" },
    { userId: "2", name: "Anabel Ruiz" },
    { userId: "3", name: "Ben Ito" },
  ];

  it("finds members by name prefix ignoring case and spaces", () => {
    expect(searchMentionCandidates(members, "ana").map((m) => m.userId)).toEqual(["1", "2"]);
    expect(searchMentionCandidates(members, "AnaLo").map((m) => m.userId)).toEqual(["1"]);
  });

  it("caps results at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ userId: String(i), name: `Sam ${i}` }));
    expect(searchMentionCandidates(many, "sam")).toHaveLength(8);
  });

  it("picks an exact full name or a unique first name, never a guess", () => {
    const candidates = searchMentionCandidates(members, "ana");
    expect(pickMention(candidates, "AnaLopez")?.userId).toBe("1");
    expect(pickMention(searchMentionCandidates(members, "ben"), "Ben")?.userId).toBe("3");
    expect(pickMention(candidates, "An")).toBeNull();
  });
});
