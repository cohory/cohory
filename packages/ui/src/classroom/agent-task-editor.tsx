"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "../primitives/button";
import { Field } from "../primitives/field";
import { Input } from "../primitives/input";
import { Select } from "../primitives/select";
import { Textarea } from "../primitives/textarea";
import { AgentJsonField } from "./agent-json-field";
import {
  defaultTaskSchemas,
  evaluationSpecTemplates,
  type AgentEvaluationKind,
  type AgentEvaluationValue,
  type AgentJsonCheck,
  type AgentTaskValue,
} from "./agent-types";

type Errors = Readonly<Record<string, string>>;

const kindLabels: Readonly<Record<AgentEvaluationKind, string>> = {
  schema: "JSON Schema check",
  rubric: "Rubric",
  script: "Script (runs only in the agent's environment)",
};

const kindHints: Readonly<Record<AgentEvaluationKind, string>> = {
  schema: 'An object with "schema", a JSON Schema the output must match.',
  rubric: 'An object with "criteria" (id, description, points) and "passingScore".',
  script:
    'An object with "language" and "source". Stored as text for the agent to run in its own sandbox. Cohory never runs it.',
};

interface AgentTaskEditorProps {
  tasks: AgentTaskValue[];
  evaluations: AgentEvaluationValue[];
  onChange(next: { tasks: AgentTaskValue[]; evaluations: AgentEvaluationValue[] }): void;
  check?: AgentJsonCheck;
  errors?: Errors;
  disabled?: boolean;
}

function toKind(value: string): AgentEvaluationKind {
  return value === "rubric" || value === "script" ? value : "schema";
}

function nextTaskId(tasks: readonly AgentTaskValue[]): string {
  for (let index = tasks.length + 1; ; index += 1) {
    const id = `task-${index}`;
    if (!tasks.some((task) => task.id === id)) return id;
  }
}

function AgentTaskEditor({
  tasks,
  evaluations,
  onChange,
  check,
  errors = {},
  disabled = false,
}: AgentTaskEditorProps) {
  function setTask(index: number, patch: Partial<AgentTaskValue>) {
    const previous = tasks[index];
    const nextTasks = tasks.map((task, i) => (i === index ? { ...task, ...patch } : task));
    const renamed = previous && patch.id !== undefined && patch.id !== previous.id;
    onChange({
      tasks: nextTasks,
      evaluations: renamed
        ? evaluations.map((evaluation) =>
            evaluation.taskId === previous.id
              ? { ...evaluation, taskId: patch.id ?? "" }
              : evaluation,
          )
        : evaluations,
    });
  }

  function setEvaluation(index: number, patch: Partial<AgentEvaluationValue>) {
    onChange({
      tasks,
      evaluations: evaluations.map((evaluation, i) =>
        i === index ? { ...evaluation, ...patch } : evaluation,
      ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="agent-tasks-heading" className="flex flex-col gap-3">
        <h3 id="agent-tasks-heading" className="text-base font-medium text-text">
          Tasks
        </h3>
        <p className="text-sm text-text-muted">
          Each task tells the agent what to produce. The input and expected output are JSON Schemas.
        </p>
        {tasks.map((task, index) => (
          <fieldset
            key={index}
            className="flex flex-col gap-4 rounded-md border border-border bg-surface p-3 md:p-4"
          >
            <legend className="px-1 text-sm font-medium text-text">Task {index + 1}</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Task id" error={errors[`tasks.${index}.id`]}>
                {(control) => (
                  <Input
                    {...control}
                    value={task.id}
                    maxLength={64}
                    disabled={disabled}
                    onChange={(event) => setTask(index, { id: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Task title" error={errors[`tasks.${index}.title`]}>
                {(control) => (
                  <Input
                    {...control}
                    value={task.title}
                    maxLength={120}
                    disabled={disabled}
                    onChange={(event) => setTask(index, { title: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label="Prompt" description="Markdown." error={errors[`tasks.${index}.prompt`]}>
              {(control) => (
                <Textarea
                  {...control}
                  value={task.prompt}
                  rows={4}
                  disabled={disabled}
                  onChange={(event) => setTask(index, { prompt: event.target.value })}
                />
              )}
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <AgentJsonField
                label="Input schema"
                kind="schema"
                value={task.inputSchema}
                check={check}
                error={errors[`tasks.${index}.inputSchema`]}
                disabled={disabled}
                onChange={(inputSchema) => setTask(index, { inputSchema })}
              />
              <AgentJsonField
                label="Expected output schema"
                kind="schema"
                value={task.outputSchema}
                check={check}
                error={errors[`tasks.${index}.outputSchema`]}
                disabled={disabled}
                onChange={(outputSchema) => setTask(index, { outputSchema })}
              />
            </div>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    tasks: tasks.filter((_, i) => i !== index),
                    evaluations: evaluations.filter((evaluation) => evaluation.taskId !== task.id),
                  })
                }
              >
                <Trash2Icon className="size-4" aria-hidden="true" />
                Remove task {index + 1}
              </Button>
            </div>
          </fieldset>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || tasks.length >= 20}
            onClick={() =>
              onChange({
                tasks: [
                  ...tasks,
                  {
                    id: nextTaskId(tasks),
                    title: "",
                    prompt: "",
                    inputSchema: defaultTaskSchemas.input,
                    outputSchema: defaultTaskSchemas.output,
                  },
                ],
                evaluations,
              })
            }
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            Add task
          </Button>
        </div>
      </section>
      <section aria-labelledby="agent-evaluations-heading" className="flex flex-col gap-3">
        <h3 id="agent-evaluations-heading" className="text-base font-medium text-text">
          Evaluations
        </h3>
        <p className="text-sm text-text-muted">
          Evaluations run in the agent&apos;s own environment. Results agents report are self
          reported.
        </p>
        {evaluations.map((evaluation, index) => (
          <fieldset
            key={index}
            className="flex flex-col gap-4 rounded-md border border-border bg-surface p-3 md:p-4"
          >
            <legend className="px-1 text-sm font-medium text-text">Evaluation {index + 1}</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Task" error={errors[`evaluations.${index}.taskId`]}>
                {(control) => (
                  <Select
                    {...control}
                    value={evaluation.taskId}
                    disabled={disabled}
                    onChange={(event) => setEvaluation(index, { taskId: event.target.value })}
                  >
                    {tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title || task.id}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Kind">
                {(control) => (
                  <Select
                    {...control}
                    value={evaluation.kind}
                    disabled={disabled}
                    onChange={(event) => {
                      const kind = toKind(event.target.value);
                      setEvaluation(index, { kind, spec: evaluationSpecTemplates[kind] });
                    }}
                  >
                    {(Object.keys(kindLabels) as AgentEvaluationKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabels[kind]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <AgentJsonField
              label="Specification"
              description={kindHints[evaluation.kind]}
              kind="spec"
              value={evaluation.spec}
              check={evaluation.kind === "schema" ? check : undefined}
              error={errors[`evaluations.${index}.spec`]}
              disabled={disabled}
              rows={evaluation.kind === "script" ? 8 : 6}
              onChange={(spec) => setEvaluation(index, { spec })}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onChange({ tasks, evaluations: evaluations.filter((_, i) => i !== index) })
                }
              >
                <Trash2Icon className="size-4" aria-hidden="true" />
                Remove evaluation {index + 1}
              </Button>
            </div>
          </fieldset>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || tasks.length === 0 || evaluations.length >= 40}
            onClick={() =>
              onChange({
                tasks,
                evaluations: [
                  ...evaluations,
                  {
                    taskId: tasks[0]?.id ?? "",
                    kind: "schema",
                    spec: evaluationSpecTemplates.schema,
                  },
                ],
              })
            }
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            Add evaluation
          </Button>
        </div>
      </section>
    </div>
  );
}

export { AgentTaskEditor, type AgentTaskEditorProps };
