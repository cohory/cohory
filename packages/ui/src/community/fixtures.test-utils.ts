import type { PostDocument } from "./content";

export const NOW = new Date("2026-10-18T12:00:00Z");

export function textDocument(...paragraphs: string[]): PostDocument {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}
