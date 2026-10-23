import { describe, expect, it } from "vitest";

import { draftAgentLayer } from "./draft";
import { agentLessonLayerSchema } from "./format";

const lessonBody = `# Plan a release

Releases go out every Tuesday. Keep them small.

<div onclick="steal()">Hidden html</div>

\`\`\`bash
git tag v1.0.0
\`\`\`

## Exercises

1. Write a checklist for your team.
2. Tag a release in a test repository.
   1. Nested steps are part of the parent.

## Notes

1. This list is not an exercise.

\`\`\`python
print("hi")
\`\`\`
`;

describe("draft from lesson", () => {
  it("builds the objective, instructions, tasks, and templates", () => {
    const draft = draftAgentLayer({ title: "Releases", bodyMarkdown: lessonBody });
    expect(draft.objective).toBe("Plan a release");
    expect(draft.instructions).toContain("Releases go out every Tuesday.");
    expect(draft.instructions).not.toContain("<div");
    expect(draft.tasks.map((task) => task.prompt)).toEqual([
      "Write a checklist for your team.",
      "Tag a release in a test repository.",
    ]);
    expect(draft.tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(draft.templates).toEqual([
      expect.objectContaining({
        name: "snippet-1.sh",
        language: "bash",
        content: "git tag v1.0.0\n",
      }),
      expect.objectContaining({ name: "snippet-2.py", language: "python" }),
    ]);
    expect(draft.evaluations).toHaveLength(2);
  });

  it("is deterministic and passes validation", () => {
    const first = draftAgentLayer({ title: "Releases", bodyMarkdown: lessonBody });
    expect(draftAgentLayer({ title: "Releases", bodyMarkdown: lessonBody })).toEqual(first);
    expect(agentLessonLayerSchema.safeParse(first).success).toBe(true);
  });

  it("falls back to the first sentence, then the title", () => {
    expect(
      draftAgentLayer({ title: "T", bodyMarkdown: "Learn to cook. Then eat." }).objective,
    ).toBe("Learn to cook.");
    const empty = draftAgentLayer({ title: "Welcome", bodyMarkdown: null });
    expect(empty.objective).toBe("Welcome");
    expect(empty.tasks).toEqual([]);
    expect(agentLessonLayerSchema.safeParse(empty).success).toBe(true);
  });
});
