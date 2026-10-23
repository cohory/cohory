import { safeRedirectPath } from "@cohory/auth";
import { getSession } from "@cohory/auth/next";
import { getLegalConfig, signUpConsent } from "@cohory/config/legal";
import { getPlatformConfig, type SignUpMode } from "@cohory/config/platform";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TextLink, withNext } from "../../../lib/auth/form-links";
import { loadJoinIntentHeader } from "../../../lib/communities/join-context";
import { signUpOfferedFor } from "../../../lib/communities/join-intent";
import { JoiningCommunity } from "../joining-community";
import { SignUpForm } from "./sign-up-form";

function defaultLine(next: string): string {
  return next === "/communities/new"
    ? "Create your account, then name your community."
    : "One account works in every community you join.";
}

export const metadata: Metadata = {
  title: "Create your account",
  alternates: { canonical: "/sign-up" },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function SignInFooter({ next }: { next: string }) {
  return (
    <CardFooter className="text-sm text-text-muted">
      <p>
        Already have an account? <TextLink href={withNext("/sign-in", next)}>Sign in</TextLink>
      </p>
    </CardFooter>
  );
}

function NoSignUp({ mode, next }: { mode: Exclude<SignUpMode, "open">; next: string }) {
  const instanceName = getPlatformConfig().instance.name;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">
          {mode === "closed" ? "Sign up is closed" : "You need an invite"}
        </CardTitle>
        <CardDescription>
          {mode === "closed"
            ? `${instanceName} is not taking new accounts right now.`
            : `Accounts on ${instanceName} are by invite. Open the invite link you were sent to create one.`}
        </CardDescription>
      </CardHeader>
      <SignInFooter next={next} />
    </Card>
  );
}

export default async function SignUpPage({ searchParams }: PageProps) {
  const next = safeRedirectPath((await searchParams)["next"]);
  if (await getSession()) {
    redirect(next);
  }
  const { signUpMode, edition } = getPlatformConfig();
  if (signUpMode !== "open" && !signUpOfferedFor(signUpMode, next)) {
    return <NoSignUp mode={signUpMode} next={next} />;
  }
  const joining = await loadJoinIntentHeader(next);

  return (
    <Card>
      <CardHeader>
        {joining ? <JoiningCommunity name={joining.name} logoUrl={joining.logoUrl} /> : null}
        <CardTitle as="h1">Create your account</CardTitle>
        <CardDescription>{joining?.signUpLine ?? defaultLine(next)}</CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm redirectTo={next} consent={signUpConsent(getLegalConfig(), edition)} />
      </CardContent>
      <SignInFooter next={next} />
    </Card>
  );
}
