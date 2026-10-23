"use client";

import { authClient } from "@cohory/auth/client";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ConnectionStatus,
  PaymentProviderSelector,
  toast,
  type ConnectionPending,
  type ConnectionState,
  type CreatorTermsLinks,
  type OwnKeys,
  type PaymentsEdition,
  type ProviderCredentials,
  type SelectableProvider,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  acceptCreatorTermsAction,
  connectOwnKeysAction,
  connectProviderAction,
  connectStripeAction,
  refreshConnectionAction,
  saveProviderWebhookSecretAction,
  sendTestWebhookAction,
} from "../../lib/payments/actions";
import { authErrorMessage } from "../../lib/auth/errors";
import { DisconnectDialog, type DisconnectPaidMembers } from "./disconnect-dialog";
import { DisconnectProgress, type DisconnectRun } from "./disconnect-progress";
import { OwnershipReview, type PaymentOwnershipReview } from "./ownership-review";

export interface ConnectionSummary {
  readonly provider: SelectableProvider;
  readonly providerName: string;
  readonly status: ConnectionState;
  readonly chargesEnabled: boolean;
  readonly externalAccountId: string | null;
  readonly livemode: boolean;
  readonly webhookUrl: string | null;
  readonly webhookSecretSaved: boolean;
  readonly lastWebhookAt: string | null;
  readonly feeBilledMonthly: boolean;
}

export interface ConnectionPaidMembers extends DisconnectPaidMembers {
  readonly disconnectRun: DisconnectRun | null;
}

type Pending = "connect" | "terms" | ConnectionPending | null;

function UpdatedCreatorTerms({
  links,
  pending,
  onAccept,
}: {
  links: CreatorTermsLinks;
  pending: boolean;
  onAccept(): void;
}) {
  return (
    <Alert variant="warning">
      <AlertTitle>The Creator Terms changed</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-text">
        <span>
          Read the updated{" "}
          <a href={links.terms} className="text-link">
            Creator Terms
          </a>{" "}
          and{" "}
          <a href={links.dpa} className="text-link">
            Data Processing Agreement
          </a>
          . Accept them to keep selling memberships.
        </span>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 self-start"
          disabled={pending}
          onClick={onAccept}
        >
          {pending ? "Saving…" : "Accept the updated terms"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function ConnectionPanel({
  slug,
  edition,
  providers,
  platformFeeBps,
  canConnect,
  connection,
  paidMembers = null,
  ownershipReview = null,
  initialError = null,
  unconfirmedEmail = null,
  creatorTerms = null,
  creatorTermsOutdated = false,
}: {
  slug: string;
  edition: PaymentsEdition;
  providers: readonly SelectableProvider[];
  platformFeeBps: number;
  canConnect: boolean;
  connection: ConnectionSummary | null;
  paidMembers?: ConnectionPaidMembers | null;
  ownershipReview?: PaymentOwnershipReview | null;
  initialError?: string | null;
  unconfirmedEmail?: string | null;
  creatorTerms?: CreatorTermsLinks | null;
  creatorTermsOutdated?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState<Pending>(null);
  const [disconnecting, setDisconnecting] = useState<"owner" | "transfer" | null>(null);
  const [, startTransition] = useTransition();
  const [linkPending, setLinkPending] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [termsRequired, setTermsRequired] = useState(false);

  async function sendConfirmationLink(email: string) {
    setLinkPending(true);
    try {
      const { error: sendError } = await authClient.sendVerificationEmail({
        email,
        callbackURL: `/c/${slug}/manage/payments`,
      });
      setLinkMessage(
        sendError
          ? authErrorMessage(sendError)
          : `We sent a new link to ${email}. It works for 1 hour.`,
      );
    } catch {
      setLinkMessage(authErrorMessage({ status: 0 }));
    }
    setLinkPending(false);
  }

  function run(
    kind: Exclude<Pending, null>,
    task: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setError(null);
    setPending(kind);
    startTransition(async () => {
      const result = await task();
      setPending(null);
      if (!result.ok) {
        setError(result.message ?? "Something went wrong. Try again.");
        return;
      }
      router.refresh();
    });
  }

  function openStripe(
    kind: "connect" | "continue",
    country: string | null,
    acceptCreatorTerms: boolean,
  ) {
    run(kind, async () => {
      const result = await connectStripeAction({ slug, country, acceptCreatorTerms });
      if (result.creatorTermsRequired && creatorTerms) {
        setTermsRequired(true);
        return { ok: true };
      }
      return result;
    });
  }

  function submitOwnKeys(keys: OwnKeys) {
    run("connect", async () => {
      const result = await connectOwnKeysAction({ slug, ...keys });
      if (result.ok) toast.success("Stripe connected.");
      return result;
    });
  }

  function submitProvider(provider: SelectableProvider, credentials: ProviderCredentials) {
    if (provider !== "polar") return;
    run("connect", async () => {
      const result = await connectProviderAction({ slug, provider, ...credentials });
      if (result.ok) toast.success("Polar connected. Add the webhook to finish.");
      return result;
    });
  }

  if (!connection) {
    return (
      <PaymentProviderSelector
        edition={edition}
        providers={providers}
        platformFeeBps={platformFeeBps}
        canConnect={canConnect}
        pending={pending === "connect"}
        error={error}
        onConnectStripe={(country, accepted) => openStripe("connect", country, accepted)}
        onSubmitOwnKeys={submitOwnKeys}
        onSubmitProvider={submitProvider}
        creatorTerms={creatorTerms}
        confirmEmail={
          unconfirmedEmail
            ? {
                email: unconfirmedEmail,
                pending: linkPending,
                message: linkMessage,
                onSendLink: () => void sendConfirmationLink(unconfirmedEmail),
              }
            : null
        }
      />
    );
  }

  const providerLabel = connection.provider === "polar" ? connection.providerName : "Stripe";

  return (
    <ConnectionStatus
      {...connection}
      lastWebhookAt={connection.lastWebhookAt ? new Date(connection.lastWebhookAt) : null}
      canManage={canConnect}
      pending={pending === "connect" || pending === "terms" ? null : pending}
      error={error}
      onContinue={() => openStripe("continue", null, false)}
      onRefresh={() => run("refresh", () => refreshConnectionAction({ slug }))}
      onSaveWebhookSecret={(webhookSecret) =>
        run("secret", async () => {
          const result = await saveProviderWebhookSecretAction({ slug, webhookSecret });
          if (result.ok) toast.success("Signing secret saved.");
          return result;
        })
      }
      onSendTest={() =>
        run("test", async () => {
          const result = await sendTestWebhookAction({ slug });
          if (result.ok) toast.success("Test event received.");
          return result;
        })
      }
      onRequestDisconnect={() => setDisconnecting("owner")}
    >
      {creatorTerms && (creatorTermsOutdated || termsRequired) && canConnect ? (
        <UpdatedCreatorTerms
          links={creatorTerms}
          pending={pending === "terms"}
          onAccept={() =>
            run("terms", async () => {
              const result = await acceptCreatorTermsAction({ slug });
              if (result.ok) setTermsRequired(false);
              return result;
            })
          }
        />
      ) : null}
      {ownershipReview && canConnect && connection.status !== "disconnecting" ? (
        <OwnershipReview
          slug={slug}
          review={ownershipReview}
          providerName={providerLabel}
          onConnectOwn={() => setDisconnecting("transfer")}
          onChanged={() => router.refresh()}
        />
      ) : null}
      {connection.status === "disconnecting" ? (
        <DisconnectProgress
          slug={slug}
          run={paidMembers?.disconnectRun ?? null}
          canManage={canConnect}
          onChanged={() => router.refresh()}
        />
      ) : null}
      <DisconnectDialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null);
        }}
        transfer={disconnecting === "transfer"}
        slug={slug}
        providerName={providerLabel}
        removesFee={connection.provider === "stripe_connect"}
        paidMembers={paidMembers}
        askWhy={edition === "cloud" && canConnect}
        onDone={() => router.refresh()}
      />
    </ConnectionStatus>
  );
}
