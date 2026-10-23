"use client";

import { Button, Field, Textarea, toast } from "@cohory/ui";
import { useState, useTransition, type FormEvent } from "react";

import { saveRefundPolicyAction } from "../../lib/payments/refund-actions";

const maxLength = 280;

export function RefundPolicyForm({ slug, initial }: { slug: string; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveRefundPolicyAction({ slug, refundPolicy: value });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Refund rule saved.");
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label="Refund rule"
        description="Members see this before they pay. Leave it empty to say: Ask the creator for refunds."
        error={error ?? undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            maxLength={maxLength}
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" className="min-h-11 self-start" disabled={pending}>
        {pending ? "Saving…" : "Save refund rule"}
      </Button>
    </form>
  );
}
