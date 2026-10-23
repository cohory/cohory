import { CourseNotFoundError } from "@cohory/courses";
import { beforeEach, describe, expect, it, vi } from "vitest";

const courses = {
  getCourse: vi.fn(),
  getLesson: vi.fn(),
};

const page = {
  actor: { kind: "user", userId: "0192f0c0-0000-7000-8000-000000000001" },
  community: { id: "0192f0c0-0000-7000-8000-0000000000c1", slug: "makers", privacy: "public" },
  role: "member",
};

class NotFoundSignal extends Error {}

vi.mock("@cohory/api/services", () => ({
  getCoursesService: () => courses,
}));

vi.mock("../communities/load", () => ({
  requireFullCommunityPage: vi.fn(async () => page),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
}));

const { loadLesson } = await import("./load");

beforeEach(() => {
  courses.getCourse.mockReset();
  courses.getLesson.mockReset();
});

describe("loadLesson", () => {
  it("requests the lesson without waiting for the course", async () => {
    let finishCourse: (course: { slug: string }) => void = () => undefined;
    courses.getCourse.mockReturnValue(
      new Promise((resolve) => {
        finishCourse = resolve;
      }),
    );
    courses.getLesson.mockResolvedValue({ id: "lesson" });

    const loading = loadLesson("makers", "intro", "first-steps");
    await vi.waitFor(() => expect(courses.getLesson).toHaveBeenCalledTimes(1));
    finishCourse({ slug: "intro" });

    await expect(loading).resolves.toMatchObject({
      course: { slug: "intro" },
      lesson: { id: "lesson" },
    });
    expect(courses.getLesson).toHaveBeenCalledWith(
      page.actor,
      page.community.id,
      "intro",
      "first-steps",
    );
  });

  it("shows not found when the lesson is hidden from the viewer", async () => {
    courses.getCourse.mockResolvedValue({ slug: "intro" });
    courses.getLesson.mockRejectedValue(new CourseNotFoundError("lesson"));

    await expect(loadLesson("makers", "intro", "draft")).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
