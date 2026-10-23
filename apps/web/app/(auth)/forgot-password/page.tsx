import { getPlatformConfig } from "@cohory/config/platform";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";

import { TextLink } from "../../../lib/auth/form-links";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  alternates: { canonical: "/forgot-password" },
};

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Reset your password</CardTitle>
        <CardDescription>
          Enter the email for your {getPlatformConfig().instance.name} account. We will send you a
          link to choose a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
      <CardFooter className="text-sm text-text-muted">
        <TextLink href="/sign-in">Back to sign in</TextLink>
      </CardFooter>
    </Card>
  );
}
