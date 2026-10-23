import { getAgentsService } from "@cohory/agents";
import { getOAuthService } from "@cohory/agents/oauth";
import { emailSendingConfigured } from "@cohory/auth";
import type { Metadata } from "next";
import Link from "next/link";

import { AgentDrafts } from "../../../../../../components/agents/agent-drafts";
import { AgentsManager } from "../../../../../../components/agents/agents-manager";
import { ConnectAssistant } from "../../../../../../components/oauth/connect-assistant";
import { ApprovalAlertPrompt } from "../../../../../(platform)/account/confirm-email-prompt";
import { agentItem, agentPicker } from "../../../../../../lib/agents/views";
import { requireManagePage } from "../../../../../../lib/manage/load";
import { getPostsService } from "@cohory/api/services";
import { currentSession } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({
  params,
}: PageProps<"/c/[slug]/manage/settings/agents">) {
  const manage = await requireManagePage((await params).slug, "settings");
  const [agents, drafts, apps, session] = await Promise.all([
    getAgentsService().listAgents(manage.actor, manage.communityId),
    getPostsService().listDrafts(manage.actor, manage.communityId),
    getOAuthService().listConnectedApps(manage.actor, manage.communityId),
    currentSession(),
  ]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-2xl font-semibold text-text">Agents</h3>
        <p className="text-sm text-text-muted">
          Give an AI assistant or automation its own identity and token. Everything it does is in
          the{" "}
          <Link
            href={`/c/${manage.slug}/manage/settings/audit-log?actorType=agent`}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            audit log
          </Link>{" "}
          with its name and owner. Changes and revocations take effect on its next request.
        </p>
      </div>
      {session && !session.user.emailVerified && emailSendingConfigured() ? (
        <ApprovalAlertPrompt email={session.user.email} />
      ) : null}
      <ConnectAssistant
        mcpUrl={getOAuthService().issuer.resource}
        communityName={manage.page.community.name}
        canConnect
        titleAs="h4"
      />
      <AgentDrafts
        slug={manage.slug}
        drafts={drafts.map((draft) => ({
          id: draft.id,
          title: draft.title,
          excerpt: draft.excerpt,
          authorName: draft.author.name,
          agentName: draft.agent?.name ?? null,
          categoryName: draft.category?.name ?? null,
          createdAt: draft.createdAt.toISOString(),
        }))}
      />
      <AgentsManager
        slug={manage.slug}
        path={`/c/${manage.slug}/manage/settings/agents`}
        now={new Date().toISOString()}
        activityHref={`/c/${manage.slug}/manage/settings/audit-log`}
        {...agentPicker(manage.role)}
        agents={agents.map((agent) => agentItem(agent, apps))}
        headingAs="h4"
      />
    </>
  );
}
