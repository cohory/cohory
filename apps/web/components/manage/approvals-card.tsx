import { getApprovalsService } from "@cohory/agents/approvals";
import type { Actor } from "@cohory/authz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export async function ApprovalsCard({
  actor,
  communityId,
  slug,
}: {
  actor: Actor;
  communityId: string;
  slug: string;
}) {
  const waiting = await getApprovalsService().pendingCount(actor, communityId);
  const description =
    waiting === 0
      ? "No agent requests are waiting for you."
      : waiting === 1
        ? "1 agent request is waiting for you."
        : `${waiting} agent requests are waiting for you.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Approvals</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href={`/c/${slug}/manage/inbox?tab=approvals`}
          className="flex min-h-11 items-center justify-between gap-2 rounded-sm text-sm font-medium text-text outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {waiting === 0 ? "See past decisions" : "Review requests"}
          <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />
        </Link>
      </CardContent>
    </Card>
  );
}
