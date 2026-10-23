import { findMentions, type MentionTarget } from "./compose-document";

type MentionResolver = (
  username: string,
) => MentionTarget | null | undefined | Promise<MentionTarget | null | undefined>;

async function resolveMentions(
  text: string,
  resolver: MentionResolver | undefined,
): Promise<(username: string) => MentionTarget | null> {
  if (!resolver) return () => null;
  const names = findMentions(text);
  const entries = await Promise.all(
    names.map(async (name) => [name, (await resolver(name)) ?? null] as const),
  );
  const resolved = new Map(entries);
  return (username) => resolved.get(username) ?? null;
}

export { resolveMentions, type MentionResolver };
