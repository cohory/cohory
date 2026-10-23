"use client";

import { Badge, Button } from "@cohory/ui";
import { formatDateTimeWithZone } from "@cohory/ui/lib/format-date";
import { useState, useTransition } from "react";

import { listWebhookDeliveriesAction } from "../../lib/webhooks/actions";
import { deliveryResult, eventLabel, type DeliveryRow } from "../../lib/webhooks/views";
import { DeliveryDetail } from "./delivery-detail";

const statusBadge = {
  pending: { label: "Retrying", variant: "warning" },
  succeeded: { label: "Delivered", variant: "success" },
  failed: { label: "Failed", variant: "neutral" },
} as const;

function when(value: string): string {
  return formatDateTimeWithZone(value, { timeZone: "UTC" });
}

function StatusBadge({ row }: { row: DeliveryRow }) {
  const badge = statusBadge[row.status];
  return (
    <Badge variant={badge.variant}>
      {row.status === "pending" && row.attempts === 0 ? "Queued" : badge.label}
    </Badge>
  );
}

function resultLine(row: DeliveryRow): string {
  const attempts = row.attempts === 1 ? "1 attempt" : `${row.attempts} attempts`;
  const next =
    row.status === "pending" && row.attempts > 0 && row.nextAttemptAt
      ? `, next try ${when(row.nextAttemptAt)}`
      : "";
  return `${deliveryResult(row)}. ${attempts}${next}.`;
}

export function DeliveryLog({
  slug,
  endpointId,
  active,
  initialRows,
  initialCursor,
}: {
  slug: string;
  endpointId: string;
  active: boolean;
  initialRows: DeliveryRow[];
  initialCursor: string | null;
}) {
  const [source, setSource] = useState(initialRows);
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  if (source !== initialRows) {
    setSource(initialRows);
    setRows(initialRows);
    setCursor(initialCursor);
  }

  function load(append: boolean) {
    startTransition(async () => {
      const result = await listWebhookDeliveriesAction({
        slug,
        endpointId,
        cursor: append ? (cursor ?? undefined) : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setRows((current) => (append ? [...current, ...result.data.rows] : result.data.rows));
      setCursor(result.data.nextCursor);
    });
  }

  function details(row: DeliveryRow) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        aria-label={`Details of ${eventLabel(row.eventType)} from ${when(row.createdAt)}`}
        onClick={() => setOpen(row.id)}
      >
        Details
      </Button>
    );
  }

  return (
    <section aria-label="Delivery log" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-semibold text-text">Delivery log</h4>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={loading}
          onClick={() => load(false)}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No deliveries yet. Send a test event to try it.</p>
      ) : (
        <>
          <ul aria-label="Deliveries" className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge row={row} />
                  <span className="text-sm text-text-muted">{when(row.createdAt)}</span>
                </div>
                <span className="text-sm font-medium text-text">{eventLabel(row.eventType)}</span>
                <span className="text-sm text-text">{resultLine(row)}</span>
                <span className="self-start">{details(row)}</span>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-md border border-border sm:block">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">Deliveries</caption>
              <thead className="bg-surface-raised text-text-muted">
                <tr>
                  <th scope="col" className="w-48 px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="w-28 px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Event
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Result
                  </th>
                  <th scope="col" className="w-28 px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 text-text-muted">{when(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge row={row} />
                    </td>
                    <td className="px-3 py-2 text-text">
                      {eventLabel(row.eventType)}
                      <span className="block font-mono text-xs break-all text-text-muted">
                        {row.eventId}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text">{resultLine(row)}</td>
                    <td className="px-1 py-0.5 text-right">{details(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {cursor ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 self-start"
          disabled={loading}
          onClick={() => load(true)}
        >
          Older deliveries
        </Button>
      ) : null}
      {open ? (
        <DeliveryDetail
          key={open}
          slug={slug}
          endpointId={endpointId}
          deliveryId={open}
          canResend={active}
          onClose={() => setOpen(null)}
          onResent={() => {
            setOpen(null);
            load(false);
          }}
        />
      ) : null}
    </section>
  );
}
