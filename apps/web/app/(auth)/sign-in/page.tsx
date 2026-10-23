import { emailSendingConfigured, safeRedirectPath } from "@cohory/auth";
import { getSession } from "@cohory/auth/next";
import { getPlatformConfig } from "@cohory/config/platform";
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@cohory/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TextLink, withNext } from "../../../lib/auth/form-links";
import { loadJoinIntentHeader } from "../../../lib/communities/join-context";
import { parseJoinContinuePath, signUpOfferedFor } from "../../../lib/communities/join-intent";
import { JoiningCommunity } from "../joining-community";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in", alternates: { canonical: "/sign-in" } };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeRedirectPath(params["next"]);
  const deletionScheduled = params["notice"] === "deletion-scheduled";
  const linkFailed = typeof params["error"] === "string";
  if (await getSession()) {
    redirect(next);
  }
  const { instance, signUpMode } = getPlatformConfig();
  const instanceName = instance.name;
  const joining = await loadJoinIntentHeader(next);
  const line =
    joining?.signInLine ??
    (parseJoinContinuePath(next)?.kind === "post"
      ? "Sign in to see this post."
      : `Use the email and password for your ${instanceName} account.`);

  return (
    <Card>
      <CardHeader>
        {joining ? <JoiningCommunity name={joining.name} logoUrl={joining.logoUrl} /> : null}
        <CardTitle as="h1">Sign in</CardTitle>
        <CardDescription>{line}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {deletionScheduled ? (
          <Alert>
            Your account is scheduled for deletion and you are signed out everywhere. Sign in within
            14 days to cancel the deletion.
          </Alert>
        ) : null}
        {linkFailed ? (
          <Alert variant="warning">
            This sign in link has expired or was already used. Enter your email to get a new one.
          </Alert>
        ) : null}
        <SignInForm redirectTo={next} magicLink={emailSendingConfigured()} />
      </CardContent>
      {signUpOfferedFor(signUpMode, next) ? (
        <CardFooter className="text-sm text-text-muted">
          <p>
            New to {instanceName}?{" "}
            <TextLink href={withNext("/sign-up", next)}>Create an account</TextLink>
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
