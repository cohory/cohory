import MarkdownIt from "markdown-it";

import { agentLimits, type AgentLessonLayer } from "./format";
import { markdownText, plainLine, withoutRawHtml } from "./text";

type Token = ReturnType<MarkdownIt["parse"]>[number];

const parser = new MarkdownIt("default", { html: true });
const exerciseHeading = /\b(exercises?|tasks?|practice|assignments?|homework|try it|your turn)\b/i;

const extensions: Readonly<Record<string, string>> = {
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  html: "html",
  css: "css",
  markdown: "md",
  md: "md",
  ruby: "rb",
  go: "go",
  rust: "rs",
  java: "java",
  php: "php",
  csharp: "cs",
  "c#": "cs",
  c: "c",
  cpp: "cpp",
  toml: "toml",
  xml: "xml",
};

export interface LessonSource {
  readonly title: string;
  readonly bodyMarkdown: string | null;
}

function inlineText(token: Token | undefined): string {
  if (!token) return "";
  const children = token.children ?? [];
  const text = children.length
    ? children
        .filter((child) => child.type === "text" || child.type === "code_inline")
        .map((child) => child.content)
        .join("")
    : token.content;
  return plainLine(text);
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function firstSentence(paragraph: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(paragraph);
  return match?.[1] ?? paragraph;
}

function languageOf(info: string): string {
  const raw = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9+#.-]{0,29}$/.test(raw) ? raw : "text";
}

function objectiveOf(tokens: readonly Token[], title: string): string {
  const heading = tokens.findIndex((token) => token.type === "heading_open");
  if (heading !== -1) {
    const text = inlineText(tokens[heading + 1]);
    if (text) return clip(text, agentLimits.objective);
  }
  const paragraph = tokens.findIndex((token) => token.type === "paragraph_open");
  if (paragraph !== -1) {
    const text = firstSentence(inlineText(tokens[paragraph + 1]));
    if (text) return clip(text, agentLimits.objective);
  }
  return clip(plainLine(title) || "Complete this lesson", agentLimits.objective);
}

function exerciseItems(tokens: readonly Token[]): string[] {
  const items: string[] = [];
  let underExercises = false;
  let depth = 0;
  let inItem = false;
  let current: string[] = [];
  tokens.forEach((token, index) => {
    if (token.type === "heading_open") {
      underExercises = exerciseHeading.test(inlineText(tokens[index + 1]));
    }
    if (token.type === "ordered_list_open") depth += 1;
    if (token.type === "ordered_list_close") depth -= 1;
    if (!underExercises || depth !== 1) return;
    if (token.type === "list_item_open" && token.level === 1) {
      inItem = true;
      current = [];
    } else if (token.type === "list_item_close" && token.level === 1) {
      inItem = false;
      const text = current.join(" ").trim();
      if (text) items.push(text);
    } else if (inItem && token.type === "inline") {
      current.push(inlineText(token));
    }
  });
  return items;
}

const defaultInput = { type: "object", additionalProperties: true };
const defaultOutput = {
  type: "object",
  properties: { answer: { type: "string", description: "Your result for this task." } },
  required: ["answer"],
};

export function draftAgentLayer(lesson: LessonSource): AgentLessonLayer {
  const body = markdownText(withoutRawHtml(lesson.bodyMarkdown ?? ""));
  const tokens = parser.parse(body, {});
  const fences = tokens.filter((token) => token.type === "fence" && token.content.trim() !== "");
  const tasks = exerciseItems(tokens)
    .slice(0, agentLimits.tasks)
    .map((prompt, index) => ({
      id: `task-${index + 1}`,
      title: clip(firstSentence(prompt), agentLimits.title),
      prompt: clip(prompt, agentLimits.prompt),
      inputSchema: defaultInput,
      outputSchema: defaultOutput,
    }));
  return {
    objective: objectiveOf(tokens, lesson.title),
    instructions: clip(body, agentLimits.instructions),
    references: [],
    templates: fences.slice(0, agentLimits.templates).map((fence, index) => {
      const language = languageOf(fence.info);
      return {
        kind: "code" as const,
        title: `Code block ${index + 1}`,
        name: `snippet-${index + 1}.${extensions[language] ?? "txt"}`,
        language,
        content: clip(fence.content, agentLimits.codeTemplate),
      };
    }),
    tasks,
    evaluations: tasks.map((task) => ({
      taskId: task.id,
      kind: "schema" as const,
      spec: { schema: defaultOutput },
    })),
  };
}
