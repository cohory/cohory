"use client";

import { Button } from "@cohory/ui";
import { useActionState } from "react";

import { confirmOptOut, type OptOutState } from "./actions";

const initialState: OptOutState = { status: "idle" };

export function OptOutForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmOptOut, initialState);

  if (state.status === "done") {
    return (
      <p role="status" className="text-sm text-text">
        Done. We will not email this address about the community again.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state.status === "invalid" ? (
        <p role="alert" className="text-sm text-danger">
          This link has expired or is not valid.
        </p>
      ) : null}
      {state.status === "limited" ? (
        <p role="alert" className="text-sm text-danger">
          You're doing that too often. Try again in {state.retryAfterSeconds} seconds.
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Stopping…" : "Stop these emails"}
      </Button>
    </form>
  );
}
