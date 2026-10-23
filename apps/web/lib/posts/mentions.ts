export interface MentionCandidate {
  readonly userId: string;
  readonly label: string;
  readonly avatarUrl?: string | null;
}

export const mentionSearchLimit = 8;

export function normalizeMentionName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function searchMentionCandidates(
  members: readonly { userId: string; name: string; image?: string | null }[],
  query: string,
): MentionCandidate[] {
  const needle = normalizeMentionName(query);
  if (needle === "") return [];
  return members
    .filter((member) => normalizeMentionName(member.name).startsWith(needle))
    .slice(0, mentionSearchLimit)
    .map((member) => ({
      userId: member.userId,
      label: member.name,
      avatarUrl: member.image ?? null,
    }));
}

export function pickMention(
  candidates: readonly MentionCandidate[],
  username: string,
): MentionCandidate | null {
  const needle = normalizeMentionName(username);
  const exact = candidates.find((candidate) => normalizeMentionName(candidate.label) === needle);
  if (exact) return exact;
  const firstNames = candidates.filter(
    (candidate) => normalizeMentionName(candidate.label.split(/\s+/)[0] ?? "") === needle,
  );
  return firstNames.length === 1 ? (firstNames[0] ?? null) : null;
}
