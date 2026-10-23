import { getPreferencesService, unsubscribeLabel } from "@cohory/notifications";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = {
  title: "Stop notification emails",
  alternates: { canonical: "/unsubscribe" },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function UnsubscribePage({ searchParams }: PageProps) {
  const raw = (await searchParams)["token"];
  const token = typeof raw === "string" ? raw : "";
  const claim = token ? getPreferencesService().readUnsubscribeToken(token) : null;

  if (!claim) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">This link has expired or is not valid</CardTitle>
          <CardDescription>
            Sign in and open Account, Notifications to change which emails you get.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm text-link" href="/account/notifications">
            Open notification settings
          </Link>
        </CardContent>
      </Card>
    );
  }

  const label = unsubscribeLabel(claim.scope);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Stop emails about {label}?</CardTitle>
        <CardDescription>
          We will stop emailing you about {label}. Notifications still show in the app.
          {claim.scope === "daily"
            ? " If you help run a community, join request emails stop too."
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UnsubscribeForm token={token} label={label} />
      </CardContent>
    </Card>
  );
}
