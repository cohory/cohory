"use client";

import { Button } from "@cohory/ui";
import { useActionState } from "react";

import { joinCommunityAction, type MembershipActionState } from "../app/c/[slug]/actions";

const initialState: MembershipActionState = { status: "idle" };

export function JoinButton({
  slug,
  label = "Join community",
  note = null,
}: {
  slug: string;
  label?: string;
  note?: string | null;
}) {
  const [state, action, pending] = useActionState(
    joinCommunityAction.bind(null, slug),
    initialState,
  );

  return (
    <form action={action} className="flex w-full flex-col gap-2 md:w-auto md:items-start">
      <Button type="submit" disabled={pending} className="min-h-11 w-full md:w-auto">
        {pending ? "Joining…" : label}
      </Button>
      {note ? <p className="text-sm text-text-muted">{note}</p> : null}
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
