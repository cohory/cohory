import { UsersRoundIcon } from "lucide-react";

import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";

interface ExistingSubscribersCardProps {
  href: string;
  connected: boolean;
  linking: boolean;
  linkedCount?: number;
  invitedCount?: number;
  className?: string;
}

function countLine(linked: number, invited: number): string | null {
  if (linked === 0 && invited === 0) {
    return null;
  }
  const parts = [
    linked > 0 ? `${linked} ${linked === 1 ? "subscription" : "subscriptions"} linked` : null,
    invited > 0 ? `${invited} ${invited === 1 ? "person" : "people"} invited` : null,
  ].filter((part): part is string => part !== null);
  return `${parts.join(", ")}.`;
}

function MovingContent({ href }: { href: string }) {
  return (
    <CardContent className="flex flex-col gap-3">
      <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
        <li>Existing subscriptions can&apos;t be linked on this server.</li>
        <li>Each person gets an email with the date their free time ends.</li>
        <li>You see who has moved, so you know which old subscriptions to cancel.</li>
      </ul>
      <Button asChild variant="secondary" className="min-h-11 self-start">
        <a href={href}>Move paying members</a>
      </Button>
    </CardContent>
  );
}

function ExistingSubscribersCard({
  href,
  connected,
  linking,
  linkedCount = 0,
  invitedCount = 0,
  className,
}: ExistingSubscribersCardProps) {
  const counts = countLine(linkedCount, invitedCount);
  return (
    <Card data-slot="existing-subscribers-card" className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UsersRoundIcon aria-hidden="true" className="size-5 text-text-muted" strokeWidth={1.5} />
          Bring your existing subscribers
        </CardTitle>
        <CardDescription>
          {linking
            ? "Already selling memberships on your own Stripe account? Link those subscriptions to members. They keep paying on the same subscription and don't need to do anything."
            : "Members who paid you on another platform start a new subscription here. Give them free time until their old renewal date, so nobody pays twice."}
        </CardDescription>
      </CardHeader>
      {linking ? (
        <CardContent className="flex flex-col gap-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
            <li>No card details move. Payments stay in your Stripe account.</li>
            <li>
              Subscriptions that another platform created can&apos;t be linked. Those members get
              free time to subscribe again.
            </li>
            <li>After linking, members manage or cancel billing from their membership page.</li>
          </ul>
          {counts ? <p className="text-sm text-text">{counts}</p> : null}
          {connected ? (
            <Button asChild variant="secondary" className="min-h-11 self-start">
              <a href={href}>Review existing subscriptions</a>
            </Button>
          ) : (
            <>
              <p className="text-sm text-text-muted">
                Connect the Stripe account that holds your subscriptions in Payments first.
              </p>
              <Button asChild variant="secondary" className="min-h-11 self-start">
                <a href={href}>Move paying members</a>
              </Button>
            </>
          )}
        </CardContent>
      ) : (
        <MovingContent href={href} />
      )}
    </Card>
  );
}

export { ExistingSubscribersCard, type ExistingSubscribersCardProps };
