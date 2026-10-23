import { requireFullCommunityPage } from "../../../../lib/communities/load";

export default async function MemberSectionsLayout({ params, children }: LayoutProps<"/c/[slug]">) {
  await requireFullCommunityPage((await params).slug);
  return children;
}
