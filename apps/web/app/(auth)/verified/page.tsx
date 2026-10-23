import { safeRedirectPath, signInPath } from "@cohory/auth";
import { getSession } from "@cohory/auth/next";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { TextLink } from "../../../lib/auth/form-links";
import { ResendVerificationForm } from "./resend-verification-form";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function VerifiedPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeRedirectPath(params["next"]);
  const failed = typeof params["error"] === "string";
  const session = await getSession();

  if (failed && !session?.user.emailVerified) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">This link has expired</CardTitle>
          <CardDescription>
            Confirmation links work for 1 hour and only once. Send a new link and open the newest
            email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResendVerificationForm
            {...(session ? { email: session.user.email } : {})}
            callbackURL={next}
          />
        </CardContent>
        <CardFooter className="text-sm text-text-muted">
          <TextLink href={signInPath(next)}>Back to sign in</TextLink>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Email confirmed</CardTitle>
        <CardDescription>
          {session
            ? "Your email address is confirmed."
            : "Your email address is confirmed. Sign in to continue."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href={session ? next : signInPath(next)}>{session ? "Continue" : "Sign in"}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
