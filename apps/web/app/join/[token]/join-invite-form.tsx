"use client";

import { Button } from "@cohory/ui";
import { useActionState, useEffect, useRef } from "react";

import { redeemInviteAction } from "../../../lib/manage/actions";
import type { JoinInviteState } from "../../../lib/manage/invite";

const initialState: JoinInviteState = { status: "idle" };

export function JoinInviteForm({ token, autoSubmit }: { token: string; autoSubmit: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  const [state, action, pending] = useActionState(
    redeemInviteAction.bind(null, token),
    initialState,
  );

  // The page allows this only for the person who pressed Create account or Sign in on this invite.
  useEffect(() => {
    if (autoSubmit && !submitted.current) {
      submitted.current = true;
      formRef.current?.requestSubmit();
    }
  }, [autoSubmit]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? "Joining…" : "Join community"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
