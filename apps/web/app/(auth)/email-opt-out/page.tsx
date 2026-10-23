import { optOutSecretFromEnv, verifyOptOutToken } from "@cohory/email";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";

import { OptOutForm } from "./opt-out-form";

export const metadata: Metadata = {
  title: "Stop emails about a community",
  robots: { index: false },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function EmailOptOutPage({ searchParams }: PageProps) {
  const raw = (await searchParams)["token"];
  const token = typeof raw === "string" && raw.length <= 512 ? raw : "";
  const claim = token ? verifyOptOutToken(optOutSecretFromEnv(), token) : null;

  if (!claim) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">This link has expired or is not valid</CardTitle>
          <CardDescription>
            Use the link in a newer email from the community, or ignore its emails.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Stop emails about this community?</CardTitle>
        <CardDescription>
          We will not send this address invitations or other email about the community again. Emails
          you ask for yourself, like a password reset, still arrive.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OptOutForm token={token} />
      </CardContent>
    </Card>
  );
}
