"use client";

import { useRouter } from "next/navigation";

import { createCourseAction } from "../../lib/courses/actions";
import { courseHref } from "../../lib/courses/hrefs";
import { CourseForm } from "./course-form";

export function NewCourseForm({ slug }: { slug: string }) {
  const router = useRouter();
  return (
    <CourseForm
      slug={slug}
      initial={{ title: "", description: "", coverKey: null, coverUrl: null }}
      submitLabel="Create course"
      pendingLabel="Creating…"
      onCancel={() => router.back()}
      onSubmit={async (value) => {
        const result = await createCourseAction({
          slug,
          title: value.title,
          description: value.description.trim() || null,
          coverKey: value.coverKey,
        });
        if (!result.ok) return result;
        router.push(courseHref(slug, result.data.courseSlug, { edit: true }));
        return null;
      }}
    />
  );
}
