"use client";

import { Alert, Button, Field, Input, Select, Textarea } from "@cohory/ui";
import { useActionState, useState } from "react";

import { requestEarlyAccess, type EarlyAccessState } from "../../../lib/early-access/actions";

export interface EarlyAccessFormProps {
  readonly token: string;
  readonly email: string;
  readonly platforms: readonly string[];
  readonly memberCounts: readonly string[];
  readonly noteMax: number;
}

export function EarlyAccessForm({
  token,
  email,
  platforms,
  memberCounts,
  noteMax,
}: EarlyAccessFormProps) {
  const [state, action, pending] = useActionState<EarlyAccessState, FormData>(requestEarlyAccess, {
    status: "idle",
    token,
  });
  const [corrected, setCorrected] = useState<EarlyAccessState | null>(null);

  if (state.status === "done") {
    return (
      <Alert variant="success">
        Thanks. We read every request and reply by email to the address you gave.
      </Alert>
    );
  }

  const failed = state.status === "invalid" ? state : null;
  const invalid = failed && corrected !== failed ? failed : null;
  const errorFor = (field: string) => (invalid?.field === field ? invalid.message : undefined);

  return (
    <form
      action={action}
      noValidate
      className="flex flex-col gap-4"
      onChange={(event) => {
        if (
          event.target instanceof Element &&
          event.target.getAttribute("name") === invalid?.field
        ) {
          setCorrected(state);
        }
      }}
    >
      <input type="hidden" name="token" value={state.token} />
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <Field label="Email" description="We reply to this address." error={errorFor("email")}>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={failed?.values.email ?? email}
          />
        )}
      </Field>
      <Field label="Platform you use today" error={errorFor("platform")}>
        {(control) => (
          <Select
            {...control}
            name="platform"
            required
            defaultValue={failed?.values.platform ?? ""}
          >
            <option value="" disabled>
              Choose a platform
            </option>
            {platforms.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Paying members today" error={errorFor("members")}>
        {(control) => (
          <Select {...control} name="members" required defaultValue={failed?.values.members ?? ""}>
            <option value="" disabled>
              Choose a number
            </option>
            {memberCounts.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Anything else (optional)"
        description={`Up to ${noteMax} characters.`}
        error={errorFor("note")}
      >
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={3}
            maxLength={noteMax}
            defaultValue={failed?.values.note ?? ""}
          />
        )}
      </Field>
      <Button type="submit" className="min-h-11 self-start" disabled={pending}>
        {pending ? "Sending request…" : "Send request"}
      </Button>
    </form>
  );
}
