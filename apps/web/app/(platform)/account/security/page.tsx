import { emailSendingConfigured } from "@cohory/auth";
import { getAccountService } from "@cohory/identity";
import { Card, CardContent, CardHeader } from "@cohory/ui";
import type { Metadata } from "next";

import { actorFor } from "../../../../lib/actor";
import { requireAccountSession } from "../session";
import { ChangeEmailForm } from "./change-email-form";
import { ChangePasswordForm } from "./change-password-form";
import { Sessions } from "./sessions";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const session = await requireAccountSession("/account/security");
  const sessions = await getAccountService().listSessions(actorFor(session), session.session.id);
  const canChangeEmail = emailSendingConfigured();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-text">Security</h1>

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="sessions-heading" className="text-lg text-text">
            Where you are signed in
          </h2>
          <p className="text-sm text-text-muted">
            Sign out any device you do not recognize. It is signed out on its next request.
          </p>
        </div>
        <Sessions sessions={sessions} />
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg text-text">Email address</h2>
          <p className="text-sm text-text-muted">
            You sign in and get emails at {session.user.email}.{" "}
            {canChangeEmail
              ? "To change it, you approve the change from this address first, then confirm the new one."
              : "This site cannot send email yet, so the address cannot be changed here. Ask the person who runs it."}
          </p>
        </CardHeader>
        {canChangeEmail ? (
          <CardContent>
            <ChangeEmailForm currentEmail={session.user.email} />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg text-text">Change password</h2>
          <p className="text-sm text-text-muted">
            Changing your password signs you out on every other device and revokes your API tokens,
            the tokens of your agents, and your connected apps.
          </p>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
