import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NewCourseForm } from "../../../../../../components/classroom/new-course-form";
import { requireFullCommunityPage } from "../../../../../../lib/communities/load";
import { canManageCourses } from "../../../../../../lib/courses/load";

export const metadata: Metadata = { title: "New course" };

export default async function NewCoursePage({ params }: PageProps<"/c/[slug]/classroom/new">) {
  const page = await requireFullCommunityPage((await params).slug);
  if (!canManageCourses(page)) notFound();

  return (
    <section
      aria-labelledby="new-course-heading"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4 md:p-6"
    >
      <div className="flex flex-col gap-1">
        <h1 id="new-course-heading" className="font-heading text-2xl text-text">
          New course
        </h1>
        <p className="text-sm text-text-muted">
          The course starts as a draft. Members see it once you publish it.
        </p>
      </div>
      <NewCourseForm slug={page.community.slug} />
    </section>
  );
}
