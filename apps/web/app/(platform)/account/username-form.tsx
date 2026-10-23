"use client";

import { Button, Field, Input } from "@cohory/ui";
import { useActionState, useState } from "react";

import { setUsernameAction, type UsernameFormState } from "../../../lib/members/actions";

const initialState: UsernameFormState = { status: "idle" };

export function UsernameForm({ username }: { username: string | null }) {
  const [state, action, pending] = useActionState(setUsernameAction, initialState);
  const [value, setValue] = useState(username ?? "");

  return (
    <form action={action} className="flex flex-col gap-5">
      <Field
        label="Username"
        description="Shown as @username on your member card and profile in every community. Use 3 to 30 lowercase letters, digits, or hyphens."
        error={state.status === "error" ? state.message : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="username"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            minLength={3}
            maxLength={31}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving username…" : "Save username"}
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {state.status === "saved" ? `${state.message} You're @${state.username}.` : null}
        </p>
      </div>
    </form>
  );
}
