import type { BlockNode, ContentDocument, InlineNode } from "./schema";

export type ContentNode =
  BlockNode | InlineNode | ContentDocument | { type: "listItem"; content: BlockNode[] };

export function childrenOf(node: ContentNode): readonly ContentNode[] {
  return "content" in node && Array.isArray(node.content) ? node.content : [];
}

export function* walk(node: ContentNode): Generator<ContentNode> {
  const stack: ContentNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    yield current;
    const children = childrenOf(current);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) {
        stack.push(child);
      }
    }
  }
}
