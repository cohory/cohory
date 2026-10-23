import { sha256Hex } from "../agent/canonical";
import { agentLessonLayerSchema, type AgentLessonLayerInput } from "../agent/format";
import { buildSnapshot } from "../agent/snapshot";

export const referenceBytes = new TextEncoder().encode("# Checklist\n\n- Ship it\n");

export function validLayer(overrides: Partial<AgentLessonLayerInput> = {}): AgentLessonLayerInput {
  return {
    objective: "Write a release checklist for a small team",
    instructions: "Read the checklist, then adapt it.\n\n```sh\necho ok\n```",
    references: [
      {
        title: "Release checklist",
        file: {
          name: "checklist.md",
          key: "communities/0190a000-0000-7000-8000-000000000001/courses/0190a000-0000-7000-8000-000000000002/agent/0190a000-0000-7000-8000-000000000003.md",
          mediaType: "text/markdown; charset=utf-8",
          size: referenceBytes.byteLength,
          sha256: sha256Hex(referenceBytes),
        },
      },
    ],
    templates: [
      {
        kind: "code",
        title: "Script",
        name: "release.sh",
        language: "bash",
        content: "#!/bin/sh\necho release\n",
      },
    ],
    tasks: [
      {
        id: "write-checklist",
        title: "Write the checklist",
        prompt: "Write a checklist for **your** team.",
        inputSchema: { type: "object", properties: { team: { type: "string" } } },
        outputSchema: {
          type: "object",
          properties: { items: { type: "array", items: { type: "string" } } },
          required: ["items"],
        },
      },
    ],
    evaluations: [
      {
        taskId: "write-checklist",
        kind: "schema",
        spec: { schema: { type: "object", required: ["items"] } },
      },
      {
        taskId: "write-checklist",
        kind: "rubric",
        spec: {
          criteria: [{ id: "complete", description: "Covers testing and rollback", points: 5 }],
          passingScore: 3,
        },
      },
      {
        taskId: "write-checklist",
        kind: "script",
        spec: { language: "python", source: "import os\nos.system('rm -rf /')\n" },
      },
    ],
    ...overrides,
  };
}

export function sampleSnapshot(publishedAt = new Date("2026-10-19T10:00:00.000Z")) {
  return buildSnapshot({
    course: {
      id: "0190a000-0000-7000-8000-000000000002",
      slug: "release-engineering",
      title: "Release engineering",
      description: "Ship small changes safely.",
    },
    lessons: [
      {
        id: "0190a000-0000-7000-8000-000000000010",
        slug: "checklists",
        title: "Checklists",
        layer: agentLessonLayerSchema.parse(validLayer()),
      },
    ],
    version: "1.0.0",
    changelog: "First version.",
    publishedAt,
    license: { id: "personal-agent-use", text: "" },
    sourceUrl: "https://cohory.example/c/makers/classroom/release-engineering",
  });
}
