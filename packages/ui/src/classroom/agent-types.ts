export interface AgentFileValue {
  name: string;
  key: string;
  mediaType: string;
  size: number;
  sha256: string;
}

export type AgentTemplateValue =
  | { kind: "file"; title: string; file: AgentFileValue }
  | { kind: "code"; title: string; name: string; language: string; content: string };

export interface AgentTaskValue {
  id: string;
  title: string;
  prompt: string;
  inputSchema: string;
  outputSchema: string;
}

export type AgentEvaluationKind = "schema" | "rubric" | "script";

export interface AgentEvaluationValue {
  taskId: string;
  kind: AgentEvaluationKind;
  spec: string;
}

export interface AgentLayerFormValue {
  objective: string;
  instructions: string;
  references: { title: string; file: AgentFileValue }[];
  templates: AgentTemplateValue[];
  tasks: AgentTaskValue[];
  evaluations: AgentEvaluationValue[];
}

export type AgentJsonCheck = (kind: "schema" | "spec", text: string) => Promise<string | null>;

export const emptyAgentLayer: AgentLayerFormValue = {
  objective: "",
  instructions: "",
  references: [],
  templates: [],
  tasks: [],
  evaluations: [],
};

export const defaultTaskSchemas = {
  input: '{\n  "type": "object"\n}',
  output:
    '{\n  "type": "object",\n  "properties": { "answer": { "type": "string" } },\n  "required": ["answer"]\n}',
};

export const evaluationSpecTemplates: Readonly<Record<AgentEvaluationKind, string>> = {
  schema: '{\n  "schema": { "type": "object" }\n}',
  rubric:
    '{\n  "criteria": [\n    { "id": "complete", "description": "Covers every step", "points": 1 }\n  ],\n  "passingScore": 1\n}',
  script: '{\n  "language": "python",\n  "source": "print(\\"check\\")"\n}',
};

export function jsonSyntaxError(text: string): string | null {
  if (text.trim() === "") return "Add JSON here.";
  try {
    JSON.parse(text);
    return null;
  } catch {
    return "This is not valid JSON. Check quotes, commas, and brackets.";
  }
}
