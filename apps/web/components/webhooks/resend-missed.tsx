"use client";

import { Alert, AlertDescription, Button, toast } from "@cohory/ui";
import { formatDateTimeWithZone } from "@cohory/ui/lib/format-date";
import { useTransition } from "react";

import { resendFailedWebhookDeliveriesAction } from "../../lib/webhooks/actions";

export function ResendMissed({
  slug,
  endpointId,
  since,
  onDone,
}: {
  slug: string;
  endpointId: string;
  since: string;
  onDone(): void;
}) {
  const [pending, startTransition] = useTransition();
  const from = formatDateTimeWithZone(since, { timeZone: "UTC" });

  function resend() {
    startTransition(async () => {
      const result = await resendFailedWebhookDeliveriesAction({ slug, endpointId, since });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const { resent } = result.data;
      toast.success(
        resent === 0
          ? "No failed deliveries to resend."
          : `${resent} ${resent === 1 ? "delivery" : "deliveries"} queued to send again.`,
      );
      onDone();
    });
  }

  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3 text-text">
        <span>{`Events from while it was off were not sent. You can resend the deliveries that failed since ${from}.`}</span>
        <span className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" disabled={pending} onClick={resend}>
            {pending ? "Resending…" : "Resend failed deliveries"}
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={onDone}>
            Not now
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
