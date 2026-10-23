import type { CourseOutlineModule } from "./course-outline";
import type { OutlineEditorModule } from "./outline-editor";
import type { CourseSummary } from "./types";

export function course(overrides: Partial<CourseSummary> = {}): CourseSummary {
  return {
    slug: "foundations",
    title: "Foundations",
    description: "Everything you need to start.",
    coverUrl: null,
    lessonCount: 12,
    status: "published",
    ...overrides,
  };
}

export function outline(): CourseOutlineModule[] {
  return [
    {
      id: "m1",
      title: "Getting started",
      lessons: [
        {
          id: "l1",
          slug: "welcome",
          title: "Welcome",
          status: "published",
          completed: true,
          href: "/l/welcome",
        },
        {
          id: "l2",
          slug: "setup",
          title: "Setup",
          status: "published",
          completed: false,
          href: "/l/setup",
        },
      ],
    },
    {
      id: "m2",
      title: "Going further",
      lessons: [
        {
          id: "l3",
          slug: "habits",
          title: "Habits",
          status: "draft",
          completed: false,
          href: "/l/habits",
        },
      ],
    },
  ];
}

export function editorModules(): OutlineEditorModule[] {
  return [
    {
      id: "m1",
      title: "Getting started",
      lessons: [
        { id: "a", title: "Alpha", status: "published" },
        { id: "b", title: "Bravo", status: "published" },
        { id: "c", title: "Charlie", status: "draft" },
      ],
    },
    { id: "m2", title: "Going further", lessons: [] },
  ];
}
