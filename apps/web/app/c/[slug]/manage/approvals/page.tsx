import { redirect } from "next/navigation";

import { requireManagePage } from "../../../../../lib/manage/load";

export default async function ApprovalsPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/approvals">) {
  const query = await searchParams;
  const manage = await requireManagePage((await params).slug, "inbox", query);
  const history = query.view === "history" ? "&view=history" : "";
  redirect(`/c/${manage.slug}/manage/inbox?tab=approvals${history}`);
}
