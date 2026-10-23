import type { ContentDocument } from "@cohory/content";

const maxPostTitleLength = 120;
const prefix = "New course: ";

export interface CourseAnnouncement {
  readonly title: string;
  readonly body: ContentDocument;
}

function postTitle(courseTitle: string): string {
  const title = `${prefix}${courseTitle}`;
  if (title.length <= maxPostTitleLength) return title;
  return `${title.slice(0, maxPostTitleLength - 1).trimEnd()}…`;
}

export function courseAnnouncement(course: {
  title: string;
  description: string | null;
  url: string;
}): CourseAnnouncement {
  const intro = course.description?.trim()
    ? [
        {
          type: "paragraph" as const,
          content: [{ type: "text" as const, text: course.description.trim() }],
        },
      ]
    : [];
  return {
    title: postTitle(course.title),
    body: {
      type: "doc",
      content: [
        ...intro,
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Open the course in Classroom",
              marks: [{ type: "link", attrs: { href: course.url } }],
            },
          ],
        },
      ],
    },
  };
}
