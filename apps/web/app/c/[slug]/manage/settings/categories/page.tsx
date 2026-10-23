import { getPostsService } from "@cohory/api/services";
import type { Metadata } from "next";

import { CategoriesForm } from "../../../../../../components/manage/categories-form";
import { requireManagePage } from "../../../../../../lib/manage/load";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesSettingsPage({
  params,
}: PageProps<"/c/[slug]/manage/settings/categories">) {
  const manage = await requireManagePage((await params).slug, "settings");
  const categories = await getPostsService().listCategories(manage.actor, manage.communityId);

  return (
    <CategoriesForm
      slug={manage.slug}
      categories={categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        color: category.color,
        staffOnly: category.staffOnly,
      }))}
    />
  );
}
