"use client";

import { Badge, Button, toast } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { changeDelegationAction, decidePurchaseAction } from "../../lib/entitlements/actions";
import { formatDay } from "./format";

export interface CourseDelegationItem {
  readonly id: string;
  readonly agentName: string;
  readonly courseTitle: string;
  readonly courseHref: string | null;
  readonly status: string;
  readonly active: boolean;
  readonly live: boolean;
  readonly expiresAt: string;
}

export interface PurchaseRequestItem {
  readonly id: string;
  readonly agentName: string;
  readonly summary: string;
  readonly state: string;
  readonly pending: boolean;
  readonly expiresAt: string;
}

const purchaseStates: Record<string, string> = {
  pending: "Waiting for you",
  approved: "Starting checkout",
  executed: "Checkout started",
  failed: "Could not start checkout",
  rejected: "Declined",
  expired: "Expired",
};

export function CourseDelegationList({
  slug,
  items,
}: {
  slug: string;
  items: readonly CourseDelegationItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(delegationId: string, action: "renew" | "revoke") {
    startTransition(async () => {
      const result = await changeDelegationAction({ slug, delegationId, action });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast(action === "renew" ? "Access renewed for 30 days." : "Access revoked.");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="course-access-heading" className="flex flex-col gap-3">
      <h2 id="course-access-heading" className="text-lg text-text">
        Course access you gave
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">
          You have not shared a course with an agent. Open a course that allows agents and choose
          Give my agent access.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words text-text">{item.agentName}</span>
                  <Badge variant={item.active ? "success" : "neutral"}>{item.status}</Badge>
                </span>
                <span className="break-words text-text-muted">
                  {item.courseHref ? (
                    <a
                      href={item.courseHref}
                      className="font-medium text-accent underline-offset-4 hover:underline"
                    >
                      {item.courseTitle}
                    </a>
                  ) : (
                    item.courseTitle
                  )}
                  {item.live ? `, until ${formatDay(item.expiresAt)}` : null}
                </span>
              </div>
              {item.live ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={pending}
                    onClick={() => change(item.id, "renew")}
                    aria-label={`Renew ${item.agentName}'s access to ${item.courseTitle}`}
                  >
                    Renew
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11 text-danger"
                    disabled={pending}
                    onClick={() => change(item.id, "revoke")}
                    aria-label={`Revoke ${item.agentName}'s access to ${item.courseTitle}`}
                  >
                    Revoke
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function PurchaseRequestList({
  slug,
  items,
}: {
  slug: string;
  items: readonly PurchaseRequestItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(approvalId: string, decision: "approve" | "reject") {
    startTransition(async () => {
      const result = await decidePurchaseAction({ slug, approvalId, decision });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      if (result.data.checkoutUrl) {
        window.location.assign(result.data.checkoutUrl);
        return;
      }
      if (decision === "approve" && result.data.state === "failed") {
        setError(
          result.data.errorCode === "already_subscribed"
            ? "You already have access, so there is nothing to buy. Nothing was charged."
            : "We could not start checkout. Nothing was charged. You can join from the membership page.",
        );
      } else {
        toast(decision === "reject" ? "Request declined." : "Request answered.");
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="purchase-heading" className="flex flex-col gap-3">
      <h2 id="purchase-heading" className="text-lg text-text">
        Purchases your agents proposed
      </h2>
      <p className="text-sm text-text-muted">
        Agents can only ask. If you approve, you go to checkout and nothing is charged until you pay
        there yourself.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">No requests.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words text-text">{item.agentName}</span>
                <Badge variant={item.pending ? "accent" : "neutral"}>
                  {purchaseStates[item.state] ?? item.state}
                </Badge>
              </span>
              <span className="break-words text-text">Asks you to {item.summary}.</span>
              {item.pending ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={pending}
                    onClick={() => decide(item.id, "approve")}
                  >
                    Approve and go to checkout
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={pending}
                    onClick={() => decide(item.id, "reject")}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
