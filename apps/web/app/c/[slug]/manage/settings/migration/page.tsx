import { permanentRedirect } from "next/navigation";

export default async function OldMigrationPage({
  params,
}: PageProps<"/c/[slug]/manage/settings/migration">) {
  permanentRedirect(`/c/${encodeURIComponent((await params).slug)}/manage/migration`);
}
