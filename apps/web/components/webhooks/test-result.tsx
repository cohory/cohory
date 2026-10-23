"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { getWebhookDeliveryAction } from "../../lib/webhooks/actions";
import { deliveryResult, type DeliveryRow } from "../../lib/webhooks/views";

const pollMs = 2_000;
const giveUpMs = 60_000;

type State =
  | { readonly kind: "waiting" }
  | { readonly kind: "done"; readonly row: DeliveryRow }
  | { readonly kind: "slow" }
  | { readonly kind: "error"; readonly message: string };

function message(state: State): string {
  switch (state.kind) {
    case "waiting":
      return "Test event queued. Waiting for the result.";
    case "slow":
      return "The test event has not been sent yet. Check the delivery log in a minute.";
    case "error":
      return state.message;
    case "done":
      return state.row.status === "succeeded"
        ? `Test event delivered. ${deliveryResult(state.row)}.`
        : `Test event failed. ${deliveryResult(state.row)}. Open it in the delivery log for the response.`;
  }
}

export function TestResult({
  slug,
  endpointId,
  deliveryId,
  onSettled,
}: {
  slug: string;
  endpointId: string;
  deliveryId: string;
  onSettled(): void;
}) {
  const [state, setState] = useState<State>({ kind: "waiting" });
  const settle = useEffectEvent(onSettled);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    async function poll() {
      const result = await getWebhookDeliveryAction({ slug, endpointId, deliveryId });
      if (stopped) return;
      if (!result.ok) {
        setState({ kind: "error", message: result.message });
        return;
      }
      const row = result.data.delivery;
      if (row.status !== "pending" || row.attempts > 0) {
        setState({ kind: "done", row });
        settle();
        return;
      }
      if (Date.now() - started >= giveUpMs) {
        setState({ kind: "slow" });
        return;
      }
      timer = setTimeout(() => void poll(), pollMs);
    }

    timer = setTimeout(() => void poll(), pollMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [slug, endpointId, deliveryId]);

  const failed = state.kind === "done" && state.row.status !== "succeeded";
  return (
    <p role="status" className={failed ? "text-sm text-danger" : "text-sm text-text"}>
      {message(state)}
    </p>
  );
}
