"use client";

import { Button } from "@cohory/ui";
import { EyeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setMemberPreviewAction } from "../../lib/courses/preview-actions";

function useMemberPreview(slug: string, on: boolean) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function toggle() {
    startTransition(async () => {
      await setMemberPreviewAction({ slug, on });
      router.refresh();
    });
  }
  return { pending, toggle };
}

export function MemberPreviewButton({ slug }: { slug: string }) {
  const { pending, toggle } = useMemberPreview(slug, true);
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={toggle}
    >
      <EyeIcon className="size-4" aria-hidden="true" />
      Preview as member
    </Button>
  );
}

export function MemberPreviewBanner({ slug }: { slug: string }) {
  const { pending, toggle } = useMemberPreview(slug, false);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-(--card-radius) border border-border bg-accent-muted px-4 py-3 text-sm text-text"
    >
      <p>Previewing as a member. Draft lessons, edit controls, and agent sections are hidden.</p>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={toggle}
      >
        Exit preview
      </Button>
    </div>
  );
}
