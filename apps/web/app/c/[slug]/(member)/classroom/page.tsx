import { Button, CourseCard } from "@cohory/ui";
import { GraduationCap, Lock, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ClassroomSkeleton } from "../../../../../components/classroom/classroom-skeleton";
import { EmptyState } from "../../../../../components/empty-state";
import { LockedSection } from "../../../../../components/joining/locked-section";
import { newCourseHref } from "../../../../../lib/courses/hrefs";
import { MemberPreviewBanner } from "../../../../../components/classroom/member-preview";
import { loadClassroom } from "../../../../../lib/courses/load";
import { readMemberPreview } from "../../../../../lib/courses/preview";
import { toCourseCards } from "../../../../../lib/courses/views";

export const metadata: Metadata = { title: "Classroom" };

export default async function ClassroomPage({ params }: PageProps<"/c/[slug]/classroom">) {
  const { slug } = await params;
  return (
    <Suspense fallback={<ClassroomSkeleton />}>
      <Classroom slug={slug} />
    </Suspense>
  );
}

async function Classroom({ slug: requestedSlug }: { slug: string }) {
  const [data, preview] = await Promise.all([loadClassroom(requestedSlug), readMemberPreview()]);
  const slug = data.page.community.slug;

  if (data.status === "forbidden") {
    if (data.page.role === null) {
      return <LockedSection page={data.page} kind="classroom" />;
    }
    return (
      <EmptyState icon={Lock} title="Courses are for members">
        Join this community to take its courses.
      </EmptyState>
    );
  }

  const previewing = data.manager && preview;
  const manager = data.manager && !preview;
  const cards = toCourseCards(slug, data.courses, {
    manager,
    showProgress: data.page.role !== null,
  });
  const newCourse = manager ? (
    <Button asChild>
      <Link href={newCourseHref(slug)}>
        <PlusIcon className="size-4" aria-hidden="true" />
        {cards.length === 0 ? "Create a course" : "New course"}
      </Link>
    </Button>
  ) : null;

  return (
    <section aria-labelledby="classroom-heading" className="flex flex-col gap-4">
      {previewing ? <MemberPreviewBanner slug={slug} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="classroom-heading" className="text-xl text-text">
          Classroom
        </h2>
        {cards.length > 0 ? newCourse : null}
      </div>
      {cards.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No courses yet" action={newCourse}>
          {manager
            ? "Create a course to share lessons with your members."
            : "Courses from this community will show up here."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.course.slug} className="flex">
              <CourseCard
                course={card.course}
                href={card.href}
                progressPercent={card.progressPercent}
                className="w-full"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
