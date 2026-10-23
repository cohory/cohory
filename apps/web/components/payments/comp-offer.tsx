"use client";

import { Alert, AlertDescription, AlertTitle, Button, toast } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { acceptCompInvitationAction } from "../../lib/payments/comp-actions";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function CompOffer({
  slug,
  communityName,
  invitationId,
  expiresAt,
}: {
  slug: string;
  communityName: string;
  invitationId: string;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept() {
    startTransition(async () => {
      const result = await acceptCompInvitationAction({ slug, invitationId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast.success("Free access accepted.");
      router.refresh();
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Alert variant="info">
        <AlertTitle>You&apos;re offered free access</AlertTitle>
        <AlertDescription className="text-text">
          {communityName} gives you free access to its paid community
          {expiresAt ? ` until ${dateFormat.format(new Date(expiresAt))}` : ""}. You don&apos;t pay
          anything, and you become a member when you accept.
        </AlertDescription>
      </Alert>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="button" onClick={accept} disabled={pending} className="min-h-11 self-start">
        {pending ? "Accepting…" : "Accept free access"}
      </Button>
    </div>
  );
}
