"use client";

import { Alert, AlertDescription, AlertTitle } from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const pollEveryMs = 3000;
const giveUpAfterMs = 60_000;

export function CheckoutPending() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started >= giveUpAfterMs) {
        window.clearInterval(timer);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, pollEveryMs);
    return () => window.clearInterval(timer);
  }, [router]);

  return timedOut ? (
    <Alert variant="info">
      <AlertTitle>Your payment is still being confirmed</AlertTitle>
      <AlertDescription>
        Stripe hasn't confirmed it yet. Refresh this page in a few minutes.
      </AlertDescription>
    </Alert>
  ) : (
    <Alert variant="info" aria-live="polite">
      <AlertTitle>Finishing setup</AlertTitle>
      <AlertDescription>
        We're confirming your payment with Stripe. This usually takes a few seconds.
      </AlertDescription>
    </Alert>
  );
}
