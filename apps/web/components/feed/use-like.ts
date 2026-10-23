"use client";

import { toast } from "@cohory/ui";
import { useState, useTransition } from "react";

import { toggleLikeAction } from "../../lib/posts/actions";

export interface LikeState {
  readonly liked: boolean;
  readonly count: number;
}

export function useLikes(slug: string, canLike: boolean, deniedMessage: string) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, LikeState>>(new Map());
  const [, startTransition] = useTransition();

  function set(id: string, state: LikeState) {
    setOverrides((current) => new Map(current).set(id, state));
  }

  function read(id: string, fallback: LikeState): LikeState {
    return overrides.get(id) ?? fallback;
  }

  function toggle(subjectType: "post" | "comment", id: string, current: LikeState) {
    if (!canLike) {
      toast(deniedMessage);
      return;
    }
    const next = { liked: !current.liked, count: current.count + (current.liked ? -1 : 1) };
    set(id, next);
    startTransition(async () => {
      const result = await toggleLikeAction({
        slug,
        subjectType,
        subjectId: id,
        liked: next.liked,
      });
      if (result.ok) {
        set(id, { liked: result.data.liked, count: result.data.likeCount });
        return;
      }
      set(id, current);
      toast.error(result.message);
    });
  }

  return { read, toggle };
}
