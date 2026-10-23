import { getLegalConfig, legalLinks } from "@cohory/config/legal";
import { canCreateCommunities, getPlatformConfig } from "@cohory/config/platform";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";

import { TextLink } from "../../../../lib/auth/form-links";
import { earlyAccessLinkFor } from "../../../../lib/early-access/service";
import { requireCurrentSession } from "../../../../lib/session";
import { CreateCommunityForm } from "./create-community-form";
import { creationClosedMessage } from "./schema";

export const metadata: Metadata = { title: "Create a community" };

export default async function NewCommunityPage() {
  const session = await requireCurrentSession("/communities/new");
  const config = getPlatformConfig();

  if (!canCreateCommunities(config.communityCreation, session.user.email)) {
    const earlyAccess = earlyAccessLinkFor(session.user.email);
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            Create a community
          </CardTitle>
          <CardDescription>
            {creationClosedMessage} Open an invite link to join an existing one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6">
          <TextLink href="/" className="text-sm">
            Go to my communities
          </TextLink>
          {earlyAccess ? (
            <TextLink href={earlyAccess} className="text-sm">
              Request early access
            </TextLink>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">
          Create a community
        </CardTitle>
        <CardDescription>
          A name and a URL are all you need. You can change the rest later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateCommunityForm
          address={config.appUrl.replace(/^https?:\/\//, "")}
          guidelinesHref={legalLinks(getLegalConfig(), config.edition).guidelines}
        />
      </CardContent>
    </Card>
  );
}
