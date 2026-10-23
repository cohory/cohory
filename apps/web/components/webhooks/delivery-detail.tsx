"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from "@cohory/ui";
import { formatDateTimeWithZone } from "@cohory/ui/lib/format-date";
import { useEffect, useState, useTransition } from "react";

import { getWebhookDeliveryAction, resendWebhookDeliveryAction } from "../../lib/webhooks/actions";
import {
  attemptResult,
  deliveryResult,
  eventLabel,
  type AttemptRow,
  type DeliveryDetailRow,
} from "../../lib/webhooks/views";

const codeClass =
  "max-h-64 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-text";

function when(value: string): string {
  return formatDateTimeWithZone(value, { timeZone: "UTC" });
}

function Attempt({ attempt, number }: { attempt: AttemptRow; number: number }) {
  const ok = attempt.responseStatus !== null && attempt.responseStatus < 300;
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-text">Attempt {number}</span>
        <Badge variant={ok ? "success" : "neutral"}>{attemptResult(attempt)}</Badge>
        <span className="text-text-muted">
          {when(attempt.at)}
          {attempt.durationMs !== null ? `, ${attempt.durationMs} ms` : ""}
        </span>
      </div>
      <details className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Request
        </summary>
        <dl className="mb-2 grid grid-cols-1 gap-x-3 gap-y-1 font-mono text-xs sm:grid-cols-[auto_1fr]">
          {attempt.headers.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-text-muted">{name}</dt>
              <dd className="break-all text-text">{value}</dd>
            </div>
          ))}
        </dl>
        <pre tabIndex={0} className={codeClass}>
          {attempt.body}
        </pre>
      </details>
      <details className="text-sm" open={!ok}>
        <summary className="flex min-h-11 cursor-pointer items-center rounded-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Response
        </summary>
        {attempt.responseBodyExcerpt ? (
          <pre tabIndex={0} className={codeClass}>
            {attempt.responseBodyExcerpt}
          </pre>
        ) : (
          <p className="text-text-muted">
            {attempt.responseStatus === null ? "No response." : "Empty body."}
          </p>
        )}
      </details>
    </li>
  );
}

export function DeliveryDetail({
  slug,
  endpointId,
  deliveryId,
  canResend,
  onClose,
  onResent,
}: {
  slug: string;
  endpointId: string;
  deliveryId: string;
  canResend: boolean;
  onClose(): void;
  onResent(): void;
}) {
  const [detail, setDetail] = useState<DeliveryDetailRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    void getWebhookDeliveryAction({ slug, endpointId, deliveryId }).then((result) => {
      if (!current) return;
      if (result.ok) setDetail(result.data);
      else setError(result.message);
    });
    return () => {
      current = false;
    };
  }, [slug, endpointId, deliveryId]);

  function resend() {
    startTransition(async () => {
      const result = await resendWebhookDeliveryAction({ slug, endpointId, deliveryId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Delivery queued to send again.");
      onResent();
    });
  }

  const delivery = detail?.delivery;
  const count = detail?.attempts.length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{delivery ? eventLabel(delivery.eventType) : "Delivery"}</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {delivery ? `webhook-id ${delivery.eventId}` : "Loading the delivery."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {detail && delivery ? (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-text">
              <span>{deliveryResult(delivery)}.</span>
              <span className="text-text-muted">Created {when(delivery.createdAt)}.</span>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 self-start"
              disabled={pending || !canResend}
              onClick={resend}
            >
              {pending ? "Resending…" : "Resend"}
            </Button>
            {canResend ? null : (
              <p className="text-sm text-text-muted">Turn the endpoint on to resend.</p>
            )}
            <section aria-labelledby="delivery-payload" className="flex flex-col gap-2">
              <h3 id="delivery-payload" className="text-sm font-medium text-text">
                Payload
              </h3>
              <pre tabIndex={0} className={codeClass}>
                {detail.payload}
              </pre>
            </section>
            <section aria-labelledby="delivery-attempts" className="flex flex-col gap-2">
              <h3 id="delivery-attempts" className="text-sm font-medium text-text">
                Attempts
              </h3>
              {count === 0 ? (
                <p className="text-sm text-text-muted">Not sent yet.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {detail.attempts.map((attempt, index) => (
                    <Attempt
                      key={`${attempt.at}-${index}`}
                      attempt={attempt}
                      number={count - index}
                    />
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
