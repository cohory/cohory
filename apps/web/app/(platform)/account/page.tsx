import { deletionGraceDays, getAccountService } from "@cohory/identity";
import { getMembersService } from "@cohory/members";
import { getLegalConfig, legalLinks } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";
import {
  Alert,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Card,
  CardContent,
  CardHeader,
} from "@cohory/ui";
import type { Metadata } from "next";

import { loadReadyDataExport } from "../../../lib/account/data-export";
import { asksWhyCreatorsLeave } from "../../../lib/feedback/service";
import { actorFor } from "../../../lib/actor";
import { initials } from "../../../lib/format";
import { ConfirmEmailPrompt } from "./confirm-email-prompt";
import { DataExportPanel } from "./data-export-panel";
import { DeleteAccount } from "./delete-account";
import { ProfileForm } from "./profile-form";
import { requireAccountSession } from "./session";
import { UsernameForm } from "./username-form";

export const metadata: Metadata = {
  title: "Account",
};

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const exportNotice = (await searchParams)["export"];
  const session = await requireAccountSession();
  const { privacy } = legalLinks(getLegalConfig(), getPlatformConfig().edition);
  const { user } = session;
  const actor = actorFor(session);
  const [username, owned, readyExport] = await Promise.all([
    getMembersService().getMyUsername(actor),
    getAccountService().ownedCommunities(actor),
    loadReadyDataExport(actor),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-text">Account</h1>
      {user.emailVerified ? null : <ConfirmEmailPrompt email={user.email} />}

      <Card>
        <CardHeader className="flex-row items-center gap-4">
          <Avatar className="size-16">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="text-xl text-accent">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <h2 id="profile-heading" className="truncate text-lg text-text">
              {user.name}
            </h2>
            {username ? <p className="truncate text-sm text-text-muted">@{username}</p> : null}
            <p className="truncate text-sm text-text-muted">{user.email}</p>
          </div>
        </CardHeader>
        <CardContent>
          <ProfileForm name={user.name} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <UsernameForm username={username} />
        </CardContent>
      </Card>

      <section aria-labelledby="data-heading" className="flex flex-col gap-3">
        <h2 id="data-heading" className="text-lg text-text">
          Your data
        </h2>
        {exportNotice === "expired" ? (
          <Alert variant="warning">
            That download link expired or belongs to another account. Ask for a new one.
          </Alert>
        ) : null}
        {exportNotice === "busy" ? (
          <Alert variant="warning">
            You downloaded your data many times in the last hour. Try the link again later.
          </Alert>
        ) : null}
        <DataExportPanel privacyHref={privacy} ready={readyExport} />
      </section>

      <section aria-labelledby="danger-heading" className="flex flex-col gap-3">
        <h2 id="danger-heading" className="text-lg text-text">
          Danger zone
        </h2>
        <DeleteAccount
          askWhy={asksWhyCreatorsLeave()}
          email={user.email}
          graceDays={deletionGraceDays}
          privacyHref={privacy}
          blockingCommunities={owned.map((community) => ({
            name: community.name,
            reason: community.reason,
            href:
              community.reason === "billing"
                ? `/c/${community.slug}/manage/payments`
                : `/c/${community.slug}/manage/settings/danger-zone`,
          }))}
        />
      </section>
    </div>
  );
}
