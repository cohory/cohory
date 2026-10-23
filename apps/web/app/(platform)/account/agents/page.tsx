import { getCoursesService, getEntitlementsService } from "@cohory/api/services";
import { getAgentsService } from "@cohory/agents";
import type { ApprovalView } from "@cohory/agents/approvals";
import { getOAuthService } from "@cohory/agents/oauth";
import { getApprovalGateway } from "@cohory/api";
import { emailSendingConfigured } from "@cohory/auth";
import type { Actor } from "@cohory/authz";
import { getCommunitiesService } from "@cohory/communities";
import { cn } from "@cohory/ui/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";

import {
  CourseDelegationList,
  PurchaseRequestList,
} from "../../../../components/agents/agent-requests";
import { AgentsManager } from "../../../../components/agents/agents-manager";
import { ConnectAssistant } from "../../../../components/oauth/connect-assistant";
import { actorFor } from "../../../../lib/actor";
import { agentItem, agentPicker } from "../../../../lib/agents/views";
import { courseHref } from "../../../../lib/courses/hrefs";
import { delegationItem } from "../../../../lib/entitlements/views";
import { ApprovalAlertPrompt } from "../confirm-email-prompt";
import { requireAccountSession } from "../session";

export const metadata: Metadata = { title: "Agents" };

function purchaseItem(view: ApprovalView) {
  return {
    id: view.id,
    agentName: view.agent.name,
    summary: view.summary,
    state: view.state,
    pending: view.state === "pending",
    expiresAt: view.expiresAt.toISOString(),
  };
}

async function lapsedPurchases(actor: Actor, slug: string) {
  try {
    const community = await getCommunitiesService().getCommunityBySlug(actor, slug);
    const purchases = await getApprovalGateway().listPurchases(actor, community.id);
    if (purchases.length === 0) return null;
    return {
      slug: community.slug,
      name: community.name,
      items: purchases.map(purchaseItem),
    };
  } catch {
    return null;
  }
}

function returnCourseSlug(value: unknown, slug: string): string | null {
  if (typeof value !== "string") return null;
  const prefix = `/c/${slug}/classroom/`;
  const rest = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return /^[a-z0-9-]{1,200}$/.test(rest) ? rest : null;
}

export default async function AccountAgentsPage({ searchParams }: PageProps<"/account/agents">) {
  const session = await requireAccountSession("/account/agents");
  const actor = actorFor(session);
  const memberships = await getCommunitiesService().listCommunitiesForUser(actor);
  const query = await searchParams;
  const requested = query.community;
  const lapsed =
    typeof requested === "string" &&
    !memberships.some(({ community }) => community.slug === requested)
      ? await lapsedPurchases(actor, requested)
      : null;
  if (lapsed) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-text">Agents</h1>
          <p className="text-sm text-text-muted">
            You are no longer a member of {lapsed.name}. Your agents there can only ask you to buy
            the membership. If you approve, you pay in Stripe Checkout yourself; then give your
            agent access to a course again.
          </p>
        </div>
        <PurchaseRequestList slug={lapsed.slug} items={lapsed.items} />
      </div>
    );
  }
  const current =
    memberships.find(({ community }) => community.slug === requested) ?? memberships[0] ?? null;
  const selected = current?.community ?? null;

  if (!selected) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-text">Agents</h1>
        <p className="text-sm text-text-muted">
          Join a community first. Your agents belong to one community each.
        </p>
      </div>
    );
  }

  const role = current?.membership.status === "active" ? current.membership.role : null;
  const [agents, delegations, purchases, courses, apps] = await Promise.all([
    getAgentsService().listOwnAgents(actor, selected.id),
    getEntitlementsService().listMyDelegations(actor, selected.id),
    getApprovalGateway().listPurchases(actor, selected.id),
    getCoursesService()
      .listCourses(actor, selected.id)
      .catch(() => []),
    getOAuthService().listMyConnectedApps(actor),
  ]);
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const returnSlug = returnCourseSlug(query.return, selected.slug);
  const returnCourse = returnSlug ? courses.find((course) => course.slug === returnSlug) : null;

  return (
    <div className="flex flex-col gap-8">
      {returnCourse ? (
        <Link
          href={courseHref(selected.slug, returnCourse.slug)}
          className="inline-flex min-h-11 items-center self-start rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to {returnCourse.title}
        </Link>
      ) : null}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">Agents</h1>
        <p className="text-sm text-text-muted">
          Create agents that act for you, give them read access to courses you have, and answer
          their purchase requests. Each agent belongs to one community.
        </p>
      </div>
      {memberships.length > 1 ? (
        <nav aria-label="Communities" className="flex flex-wrap gap-2">
          {memberships.map(({ community }) => (
            <Link
              key={community.id}
              href={`/account/agents?community=${encodeURIComponent(community.slug)}`}
              aria-current={community.id === selected.id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                community.id === selected.id
                  ? "border-accent text-text"
                  : "border-border text-text-muted hover:text-text",
              )}
            >
              {community.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {!session.user.emailVerified && emailSendingConfigured() ? (
        <ApprovalAlertPrompt email={session.user.email} />
      ) : null}
      <ConnectAssistant
        mcpUrl={getOAuthService().issuer.resource}
        communityName={selected.name}
        canConnect={role === "owner" || role === "admin"}
      />
      <PurchaseRequestList slug={selected.slug} items={purchases.map(purchaseItem)} />
      <CourseDelegationList
        slug={selected.slug}
        items={delegations.map((view) => {
          const course = courseById.get(view.courseId);
          return {
            ...delegationItem(view),
            courseTitle: course?.title ?? "A course you cannot see now",
            courseHref: course ? courseHref(selected.slug, course.slug) : null,
          };
        })}
      />
      <AgentsManager
        slug={selected.slug}
        path="/account/agents"
        now={new Date().toISOString()}
        activityHref={`/account/agents/activity?community=${encodeURIComponent(selected.slug)}`}
        {...agentPicker(role)}
        agents={agents.map((agent) =>
          agentItem(
            agent,
            apps.filter((app) => app.community.id === selected.id),
          ),
        )}
      />
    </div>
  );
}
