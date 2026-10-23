import { approvalActions, proposalScope } from "@cohory/authz";

import type { McpTool } from "./registry";

export const referenceStart = "<!-- tool-reference:start -->";
export const referenceEnd = "<!-- tool-reference:end -->";

function hints(tool: McpTool): string {
  const { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } = tool.annotations;
  return [
    readOnlyHint ? "read only" : "writes",
    destructiveHint ? "destructive" : null,
    idempotentHint ? "idempotent" : null,
    openWorldHint ? "open world" : null,
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
}

function approval(tool: McpTool): string {
  const action = tool.entry.meta.action;
  const category = action ? approvalActions[action] : undefined;
  if (action && category) {
    const scope = proposalScope(action, tool.entry.meta.scope);
    return `Yes (${category.replace("_", " ")}); agents need \`${scope}\` and proposals:write`;
  }
  if (tool.agentProposal) return "Yes (scheduling); agents also need proposals:write";
  return "No";
}

export function renderToolReference(tools: readonly McpTool[]): string {
  const rows = tools.map((tool) => {
    const { operation, entry } = tool;
    return `| \`${tool.name}\` | ${tool.title} | \`${operation.method} ${operation.path}\` (${entry.meta.operationId}) | ${entry.meta.scope ? `\`${entry.meta.scope}\`` : "session only"} | ${approval(tool)} | ${hints(tool)} | ${tool.userContent ? "Yes" : "No"} |`;
  });
  return [
    referenceStart,
    "",
    "| Tool | Title | REST operation | Scope | Approval for agents | Annotations | Member content |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    referenceEnd,
  ].join("\n");
}

export function replaceReference(document: string, reference: string): string {
  const start = document.indexOf(referenceStart);
  const end = document.indexOf(referenceEnd);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("the document has no tool reference markers");
  }
  return `${document.slice(0, start)}${reference}${document.slice(end + referenceEnd.length)}`;
}
