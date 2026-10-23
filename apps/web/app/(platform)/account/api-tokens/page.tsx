import { getAgentsService } from "@cohory/agents";
import { availableScopes } from "@cohory/authz";
import { getCommunitiesService } from "@cohory/communities";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import Link from "next/link";

import { PersonalTokens } from "../../../../components/agents/personal-tokens";
import { actorFor } from "../../../../lib/actor";
import { personalTokenItem } from "../../../../lib/agents/views";
import { requireAccountSession } from "../session";

export const metadata: Metadata = { title: "API tokens" };

export default async function ApiTokensPage() {
  const session = await requireAccountSession("/account/api-tokens");
  const actor = actorFor(session);
  const [tokens, memberships] = await Promise.all([
    getAgentsService().listPersonalTokens(actor),
    getCommunitiesService().listCommunitiesForUser(actor),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">API tokens</h1>
        <p className="text-sm text-text-muted">
          Use a token to connect scripts and tools to the {getPlatformConfig().instance.name} API.
          Send it as <code className="font-mono text-xs">Authorization: Bearer cohory_…</code>. To
          give an AI assistant access, create an agent in{" "}
          <Link
            href="/account/agents"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Account, Agents
          </Link>{" "}
          instead, so its work is labeled and its posts wait for you as drafts. Agent tokens are
          listed there. Changing or resetting your password revokes every token.{" "}
          <Link
            href="/docs/api"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            API reference
          </Link>
        </p>
      </div>
      <PersonalTokens
        now={new Date().toISOString()}
        communities={memberships.map(({ community, membership }) => ({
          id: community.id,
          name: community.name,
          available: availableScopes(
            membership.status === "active" ? membership.role : null,
            "token",
          ),
        }))}
        tokens={tokens.map(personalTokenItem)}
      />
    </div>
  );
}
