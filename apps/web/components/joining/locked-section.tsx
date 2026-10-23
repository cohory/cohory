import { Lock } from "lucide-react";

import { loadCoursePreviews, loadViewerJoinState } from "../../lib/communities/about";
import type { FullCommunityPage } from "../../lib/communities/load";
import { memberCountLabel } from "../../lib/format";
import { CourseList } from "../about/curriculum-preview";
import { JoinPanel } from "./join-panel";

export type LockedSectionKind = "classroom" | "members";

function courseLine(count: number): string {
  if (count === 0) {
    return "Courses are for members. Join to take them as soon as they're published.";
  }
  return `${count === 1 ? "1 course" : `${count} courses`} for members. Join to start learning.`;
}

function memberLine(count: number): string {
  if (count === 0) {
    return "Join to be one of the first members.";
  }
  return `${memberCountLabel(count)} ${count === 1 ? "is" : "are"} here. Join to see who they are.`;
}

export async function LockedSection({
  page,
  kind,
}: {
  page: FullCommunityPage;
  kind: LockedSectionKind;
}) {
  const { community } = page;
  const [joinState, courses] = await Promise.all([
    loadViewerJoinState(community.slug),
    kind === "classroom" ? loadCoursePreviews(community.slug) : Promise.resolve([]),
  ]);
  const title = kind === "classroom" ? "Classroom" : "Members";
  return (
    <section
      aria-labelledby="locked-heading"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-6 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-accent-muted text-accent"
      >
        <Lock className="size-6" strokeWidth={1.5} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 id="locked-heading" className="text-xl text-text">
          {title}
        </h2>
        <p className="text-base text-text-muted">
          {kind === "classroom" ? courseLine(courses.length) : memberLine(community.memberCount)}
        </p>
      </div>
      {courses.length > 0 ? (
        <div className="w-full">
          <CourseList courses={courses} />
        </div>
      ) : null}
      <div className="flex w-full flex-col items-center">
        <JoinPanel slug={community.slug} name={community.name} state={joinState} />
      </div>
    </section>
  );
}
