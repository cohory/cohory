import {
  composeDocument,
  findMentions,
  type ComposeImage,
  type MentionResolver,
  type MentionTarget,
  type PostDocument,
} from "@cohory/ui";

export async function composeWithMentions(
  text: string,
  images: ComposeImage[],
  resolver: MentionResolver,
  blocks: "all" | "paragraphs" = "all",
): Promise<PostDocument> {
  const entries = await Promise.all(
    findMentions(text).map(async (name) => [name, (await resolver(name)) ?? null] as const),
  );
  const resolved = new Map<string, MentionTarget | null>(entries);
  return composeDocument(text, images, [], {
    blocks,
    resolveMention: (name) => resolved.get(name) ?? null,
  });
}
