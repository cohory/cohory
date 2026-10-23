import { describe, expect, it } from "vitest";

import { activeMentionQuery, insertMention, mentionToken } from "./mention-suggestions";

describe("activeMentionQuery", () => {
  it("finds the name typed after @ at the caret", () => {
    const text = "Thanks @An";
    expect(activeMentionQuery(text, text.length)).toEqual({ start: 7, query: "An" });
  });

  it("ignores an email address and text without a mention at the caret", () => {
    expect(activeMentionQuery("mail ana@example", 16)).toBeNull();
    expect(activeMentionQuery("@Ana said hi", 12)).toBeNull();
    expect(activeMentionQuery("just @", 6)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the typed query with a token the composer resolves", () => {
    const text = "Thanks @An for this";
    const at = activeMentionQuery(text, 10);
    expect(at).not.toBeNull();
    if (!at) return;
    expect(insertMention(text, at, "Ana Lopez")).toEqual({
      text: "Thanks @AnaLopez for this",
      caret: 17,
    });
  });

  it("refuses a name with no characters a token can hold", () => {
    expect(mentionToken("Ζωή")).toBeNull();
    expect(insertMention("@Ζ", { start: 0, query: "Ζ" }, "Ζωή")).toBeNull();
  });
});
