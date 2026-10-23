import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@cohory/ui";
import type { Metadata } from "next";

import { TextLink } from "../../../lib/auth/form-links";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  alternates: { canonical: "/reset-password" },
  referrer: "no-referrer",
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = typeof params["token"] === "string" ? params["token"] : undefined;
  const usable = token !== undefined && token !== "" && params["error"] === undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Choose a new password</CardTitle>
        <CardDescription>You will sign in with the new password from now on.</CardDescription>
      </CardHeader>
      <CardContent>
        {usable ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Alert variant="danger">
            <AlertDescription>
              This reset link has expired or was already used.{" "}
              <TextLink href="/forgot-password">Request a new link</TextLink>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="text-sm text-text-muted">
        <TextLink href="/sign-in">Back to sign in</TextLink>
      </CardFooter>
    </Card>
  );
}
