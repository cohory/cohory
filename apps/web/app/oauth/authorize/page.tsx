import { getOAuthService } from "@cohory/agents/oauth";
import { getPlatformConfig } from "@cohory/config/platform";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CancelConnection, ConsentForm } from "../../../components/oauth/consent-form";
import { PlatformBrand } from "../../../components/platform-brand";
import { actorFor } from "../../../lib/actor";
import { requireCurrentSession } from "../../../lib/session";
import { loadCommunityAppearance } from "../../../lib/theme/load";

export const metadata: Metadata = { title: "Connect an app", robots: { index: false } };
export const dynamic = "force-dynamic";

function flatten(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) flat[key] = first;
  }
  return flat;
}

function hostOf(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="content"
      className="flex min-h-screen items-start justify-center bg-bg px-4 py-10 sm:items-center"
    >
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="self-start">
          <PlatformBrand community={null} instance={getPlatformConfig().instance} />
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const params = flatten(await searchParams);
  const oauth = getOAuthService();
  const check = await oauth.checkAuthorizationRequest(params);
  if (check.kind === "invalid") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle as="h1">We could not connect this app</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="danger">{check.message}</Alert>
          </CardContent>
        </Card>
      </Shell>
    );
  }
  if (check.kind === "redirect") {
    redirect(check.url);
  }
  const session = await requireCurrentSession(
    `/oauth/authorize?${new URLSearchParams(params).toString()}`,
  );
  const { request } = check;
  const options = await oauth.consentOptions(actorFor(session), {
    clientId: request.client.id,
    redirectHost: request.redirectHost,
  });
  const communities = await Promise.all(
    options.map(async (community) => ({
      id: community.id,
      name: community.name,
      logoUrl: (await loadCommunityAppearance(community.id)).logoUrl,
      agents: community.agents,
      available: community.available,
      preferredAgentId: community.preferredAgentId,
    })),
  );
  const website = hostOf(request.client.clientUri);

  return (
    <Shell>
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle as="h1" className="text-xl break-words">
            Connect {request.client.name}
          </CardTitle>
          <CardDescription>
            {request.client.name} wants to work in {getPlatformConfig().instance.name} as an agent
            you own. You are signed in as {session.user.name || session.user.email}.
          </CardDescription>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-text-muted">App</dt>
            <dd className="font-medium break-words text-text">{request.client.name}</dd>
            {website ? (
              <>
                <dt className="text-text-muted">Website</dt>
                <dd className="font-mono font-medium break-all text-text">{website}</dd>
              </>
            ) : null}
            <dt className="text-text-muted">Sends you back to</dt>
            <dd className="font-mono font-medium break-all text-text">{request.redirectHost}</dd>
          </dl>
          <Alert variant="warning">
            {getPlatformConfig().instance.name} has not verified this app. Approve only if you
            started this connection yourself and you trust {request.client.name}.
            {request.loopbackRedirect
              ? " It runs on your own computer, so any program there could use this name."
              : ""}
          </Alert>
        </CardHeader>
        <CardContent>
          {communities.length === 0 ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-muted">
                Only owners and admins can connect apps. Members can create an agent by hand in{" "}
                <Link
                  href="/account/agents"
                  className="font-medium text-accent underline-offset-4 hover:underline"
                >
                  Account, Agents
                </Link>{" "}
                and give the assistant its token.
              </p>
              <CancelConnection params={params} />
            </div>
          ) : (
            <ConsentForm
              params={params}
              clientName={request.client.name}
              redirectHost={request.redirectHost}
              communities={communities}
              requested={request.requestedScopes}
              preselected={request.preselectedScopes}
            />
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
