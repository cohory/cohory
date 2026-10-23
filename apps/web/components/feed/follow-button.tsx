"use client";

import { Button, toast } from "@cohory/ui";
import { cn } from "@cohory/ui/lib/utils";
import { Bell, BellRing } from "lucide-react";
import { useState, useTransition } from "react";

import { followPostAction } from "../../lib/posts/actions";

export function FollowButton({
  slug,
  postId,
  following,
}: {
  slug: string;
  postId: string;
  following: boolean;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = optimistic ?? following;

  function toggle() {
    const next = !shown;
    setOptimistic(next);
    startTransition(async () => {
      const result = await followPostAction({ slug, postId, following: next });
      if (!result.ok) {
        setOptimistic(null);
        toast.error(result.message);
        return;
      }
      toast.success(
        next
          ? "You'll get notified about new comments."
          : "You won't get notified about new comments.",
      );
    });
  }

  return (
    <Button
      variant="ghost"
      aria-pressed={shown}
      disabled={pending}
      onClick={toggle}
      className={cn("min-h-11 px-2", shown ? "text-accent" : "text-text-muted")}
    >
      {shown ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />}
      Follow
    </Button>
  );
}
