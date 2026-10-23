import type { Actor } from "@cohory/authz";
import { getMembersService } from "@cohory/members";

import { authorLevelFor, type AuthorLevel } from "./views";

interface WithAuthor {
  readonly author: { readonly id: string; readonly level?: AuthorLevel | null };
}

type Leveled<T extends WithAuthor> = T & {
  readonly author: T["author"] & { readonly level: AuthorLevel | null };
};

export function applyAuthorLevels<T extends WithAuthor>(
  items: readonly T[],
  levels: ReadonlyMap<string, AuthorLevel>,
): Leveled<T>[] {
  return items.map((item) => ({
    ...item,
    author: { ...item.author, level: levels.get(item.author.id) ?? null },
  }));
}

export async function loadAuthorLevels(
  actor: Actor,
  communityId: string,
  authorIds: readonly string[],
): Promise<ReadonlyMap<string, AuthorLevel>> {
  const ids = [...new Set(authorIds)];
  if (ids.length === 0) return new Map();
  const service = getMembersService();
  const settings = await service.getGamificationSettings(actor, communityId);
  if (!settings.enabled) return new Map();
  const levels = await service.getMemberLevels(actor, communityId, ids);
  return new Map(
    ids.flatMap((id) => {
      const level = authorLevelFor(settings, levels.get(id));
      return level ? [[id, level] as const] : [];
    }),
  );
}

export async function withAuthorLevels<T extends WithAuthor>(
  actor: Actor,
  communityId: string,
  items: readonly T[],
): Promise<Leveled<T>[]> {
  const levels = await loadAuthorLevels(
    actor,
    communityId,
    items.map((item) => item.author.id),
  );
  return applyAuthorLevels(items, levels);
}
