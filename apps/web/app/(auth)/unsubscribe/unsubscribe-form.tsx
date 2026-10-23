"use client";

import { Button } from "@cohory/ui";
import Link from "next/link";
import { useActionState } from "react";

import { confirmUnsubscribe, type UnsubscribeState } from "./actions";

const initialState: UnsubscribeState = { status: "idle" };

export function UnsubscribeForm({ token, label }: { token: string; label: string }) {
  const [state, action, pending] = useActionState(confirmUnsubscribe, initialState);

  if (state.status === "done") {
    return (
      <div role="status" className="flex flex-col gap-3 text-sm text-text">
        <p>Email for {state.label} is off. You still see them in the app.</p>
        <p>
          <Link className="text-link" href="/account/notifications">
            Change your notification settings
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state.status === "invalid" ? (
        <p role="alert" className="text-sm text-danger">
          This link has expired or is not valid. Change your email settings in Account,
          Notifications instead.
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Turning off…" : `Stop emails about ${label}`}
      </Button>
    </form>
  );
}
