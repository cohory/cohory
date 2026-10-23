import { permanentRedirect } from "next/navigation";

import { subscribersHref } from "../../../../../../../lib/payments/linking";

export default async function OldSubscribersPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/settings/migration/subscribers">) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const after = typeof search.after === "string" ? search.after : null;
  const target = subscribersHref(encodeURIComponent(slug));
  permanentRedirect(after ? `${target}?after=${encodeURIComponent(after)}` : target);
}
