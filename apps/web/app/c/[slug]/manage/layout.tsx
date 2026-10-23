import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { MomentQuestion } from "../../../../components/feedback/moment-question";
import { ManageNav } from "../../../../components/manage/manage-nav";
import { inboxTotal, loadInboxCounts } from "../../../../lib/manage/inbox";
import { loadManageShell } from "../../../../lib/manage/load";
import { manageNavHints } from "../../../../lib/manage/overview";
import { moderatorScope } from "../../../../lib/manage/sections";

export default async function ManageLayout({ params, children }: LayoutProps<"/c/[slug]/manage">) {
  const manage = await loadManageShell((await params).slug);
  if (!manage) {
    return children;
  }
  const { slug, sections } = manage;
  const [hints, counts] = await Promise.all([
    manageNavHints(manage),
    loadInboxCounts(manage.actor, manage.role, manage.communityId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/c/${slug}`}
        className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.5} />
        Back to community
      </Link>
      {manage.role === "moderator" ? (
        <p className="text-sm text-text-muted">{moderatorScope}</p>
      ) : null}
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        <ManageNav
          slug={slug}
          sections={sections}
          hints={hints}
          counts={{ inbox: inboxTotal(counts) }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {manage.role === "owner" ? (
            <MomentQuestion actor={manage.actor} communityId={manage.communityId} slug={slug} />
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
