"use client";

import { Alert, Button, Field, Input, Select, Textarea } from "@cohory/ui";
import { useActionState } from "react";

import { sendContentReport, type ReportState } from "../../../../lib/legal/report-actions";
import { reportReasons } from "../../../../lib/legal/report";

const initialState: ReportState = { status: "idle" };

export function ReportForm() {
  const [state, action, pending] = useActionState(sendContentReport, initialState);

  if (state.status === "sent") {
    return (
      <Alert variant="success">
        {state.receipt
          ? "Thanks. We received your report and review it. We emailed you a receipt and will tell you what we decide and why."
          : "Thanks. We received your report and review it. Sign in before you report if you want to hear what we decide."}
      </Alert>
    );
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      <Field label="Address of the page" description="Copy it from your browser's address bar.">
        {(control) => <Input {...control} name="pageUrl" type="url" required />}
      </Field>
      <Field label="Reason">
        {(control) => (
          <Select {...control} name="reason" defaultValue="" required>
            <option value="" disabled>
              Choose a reason
            </option>
            {reportReasons.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="What is wrong" description="Say which law or right it breaks, if you know.">
        {(control) => <Textarea {...control} name="details" rows={5} maxLength={2000} required />}
      </Field>
      <label className="flex min-h-11 items-start gap-3 text-sm text-text">
        <input type="checkbox" name="goodFaith" required className="mt-1 size-4 accent-accent" />
        <span>I believe this report is accurate and complete, and I make it in good faith.</span>
      </label>
      <Button type="submit" className="min-h-11 self-start" disabled={pending}>
        {pending ? "Sending report…" : "Send report"}
      </Button>
    </form>
  );
}
