import { maxJsonDocumentBytes } from "@cohory/courses";
import { describe, expect, it, vi } from "vitest";

vi.mock("../posts/context", () => ({ resolveCommunity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { checkAgentJsonAction, saveLessonAgentLayerAction } = await import("./agent-actions");

function schemaOfBytes(bytes: number): string {
  const head = '{"type":"object","description":"';
  const tail = '"}';
  return `${head}${"a".repeat(bytes - head.length - tail.length)}${tail}`;
}

const tooBig = "Keep this under 32 KB.";

describe("checkAgentJsonAction", () => {
  it("accepts a schema at exactly the service limit", async () => {
    await expect(
      checkAgentJsonAction({ kind: "schema", text: schemaOfBytes(maxJsonDocumentBytes) }),
    ).resolves.toBeNull();
  });

  it("refuses a schema one byte over the service limit", async () => {
    await expect(
      checkAgentJsonAction({ kind: "schema", text: schemaOfBytes(maxJsonDocumentBytes + 1) }),
    ).resolves.toBe(tooBig);
  });

  it("counts UTF-8 bytes, not characters", async () => {
    const text = `{"description":"${"é".repeat(maxJsonDocumentBytes / 2)}"}`;

    expect(text.length).toBeLessThan(maxJsonDocumentBytes);
    await expect(checkAgentJsonAction({ kind: "schema", text })).resolves.toBe(tooBig);
  });
});

describe("saveLessonAgentLayerAction", () => {
  it("refuses a task schema over the service limit before saving", async () => {
    const result = await saveLessonAgentLayerAction({
      slug: "design",
      lessonId: "0192d3c0-0000-7000-8000-000000000001",
      layer: {
        objective: "Build a form",
        instructions: "",
        references: [],
        templates: [],
        tasks: [
          {
            id: "form",
            title: "Form",
            prompt: "Build it",
            inputSchema: schemaOfBytes(maxJsonDocumentBytes + 1),
            outputSchema: "{}",
          },
        ],
        evaluations: [],
      },
    });

    expect(result).toEqual({
      ok: false,
      message: tooBig,
      fieldErrors: { "tasks.0.inputSchema": tooBig },
    });
  });
});
