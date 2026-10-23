import { isDeletionPending } from "@cohory/auth";
import { getSessionIncludingPendingDeletion } from "@cohory/auth/next";
import { getPlatformConfig } from "@cohory/config/platform";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import { formatDate } from "@cohory/ui/lib/format-date";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { cancelDeletion } from "./actions";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "Account scheduled for deletion",
  alternates: { canonical: "/cancel-deletion" },
};

export default async function CancelDeletionPage() {
  const session = await getSessionIncludingPendingDeletion();
  if (!session) {
    redirect("/sign-in");
  }
  const scheduledFor = session.user.deletionScheduledFor;
  if (!isDeletionPending(session.user) || !scheduledFor) {
    redirect("/");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Your account is scheduled for deletion</CardTitle>
        <CardDescription>
          We will delete your personal data on{" "}
          {formatDate(scheduledFor, { timeZone: "UTC", style: "long" })} (UTC). Your posts and
          comments will stay under the name Former member.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-text">
          Cancel the deletion to keep your account and use {getPlatformConfig().instance.name} as
          before.
        </p>
        <form action={cancelDeletion}>
          <Button type="submit" className="w-full">
            Cancel deletion
          </Button>
        </form>
        <SignOutButton />
      </CardContent>
    </Card>
  );
}
