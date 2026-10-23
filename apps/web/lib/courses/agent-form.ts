import type { AgentLessonLayer, AgentLessonLayerInput } from "@cohory/courses";
import type { AgentLayerFormValue } from "@cohory/ui";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function layerToForm(layer: AgentLessonLayer): AgentLayerFormValue {
  return {
    objective: layer.objective,
    instructions: layer.instructions,
    references: layer.references.map((reference) => ({
      ...reference,
      file: { ...reference.file },
    })),
    templates: layer.templates.map((template) =>
      template.kind === "file" ? { ...template, file: { ...template.file } } : { ...template },
    ),
    tasks: layer.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      prompt: task.prompt,
      inputSchema: pretty(task.inputSchema),
      outputSchema: pretty(task.outputSchema),
    })),
    evaluations: layer.evaluations.map((evaluation) => ({
      taskId: evaluation.taskId,
      kind: evaluation.kind,
      spec: pretty(evaluation.spec),
    })),
  };
}

export type FormToLayer =
  { ok: true; input: AgentLessonLayerInput } | { ok: false; fieldErrors: Record<string, string> };

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

const notJson = "This is not valid JSON. Check quotes, commas, and brackets.";

export function formToLayer(value: AgentLayerFormValue): FormToLayer {
  const fieldErrors: Record<string, string> = {};
  const json = (path: string, text: string): unknown => {
    const parsed = parse(text);
    if (!parsed.ok) {
      fieldErrors[path] = notJson;
      return null;
    }
    return parsed.value;
  };
  const tasks = value.tasks.map((task, index) => ({
    id: task.id.trim(),
    title: task.title,
    prompt: task.prompt,
    inputSchema: json(`tasks.${index}.inputSchema`, task.inputSchema),
    outputSchema: json(`tasks.${index}.outputSchema`, task.outputSchema),
  }));
  const evaluations = value.evaluations.map((evaluation, index) => ({
    taskId: evaluation.taskId,
    kind: evaluation.kind,
    spec: json(`evaluations.${index}.spec`, evaluation.spec),
  }));
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    input: {
      objective: value.objective,
      instructions: value.instructions,
      references: value.references,
      templates: value.templates,
      tasks,
      evaluations: evaluations as AgentLessonLayerInput["evaluations"],
    },
  };
}
