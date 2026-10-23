import { Badge, type BadgeProps } from "@cohory/ui";

import type { FieldView, OperationView } from "../../../lib/docs/api-reference";

const methodVariants: Readonly<Record<string, BadgeProps["variant"]>> = {
  GET: "neutral",
  POST: "success",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "accent",
};

function Fields({ title, fields }: { title: string; fields: readonly FieldView[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-text">{title}</h4>
      <dl className="flex flex-col gap-2">
        {fields.map((field) => (
          <div key={`${field.location ?? "body"}-${field.name}`} className="flex flex-col gap-0.5">
            <dt className="flex flex-wrap items-baseline gap-2 text-sm">
              <code className="font-mono text-xs text-text">{field.name}</code>
              <span className="font-mono text-xs break-all text-text-subtle">{field.type}</span>
              {field.location ? (
                <span className="text-xs text-text-subtle">in {field.location}</span>
              ) : null}
              {field.required ? <span className="text-xs text-text-muted">required</span> : null}
            </dt>
            {field.description ? (
              <dd className="text-sm text-text-muted">{field.description}</dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Operation({ operation }: { operation: OperationView }) {
  return (
    <details id={operation.id} className="group rounded-md border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Badge variant={methodVariants[operation.method] ?? "neutral"} className="font-mono">
          {operation.method}
        </Badge>
        <code className="font-mono text-sm break-all text-text">{operation.path}</code>
        <span className="text-sm text-text-muted">{operation.summary}</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
        {operation.description ? (
          <p className="text-sm whitespace-pre-line text-text">{operation.description}</p>
        ) : null}
        <p className="text-sm text-text-muted">
          {operation.scope ? (
            <>
              Token scope <code className="font-mono text-xs text-text">{operation.scope}</code>
            </>
          ) : (
            "Needs a signed in session. API tokens cannot call it."
          )}
          {" · "}
          <span className="font-mono text-xs">{operation.id}</span>
        </p>
        <Fields title="Parameters" fields={operation.parameters} />
        {operation.body ? (
          <Fields title={`Body (${operation.body.contentType})`} fields={operation.body.fields} />
        ) : null}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-text">Responses</h4>
          <ul className="flex flex-col gap-1">
            {operation.responses.map((response) => (
              <li key={response.status} className="flex gap-3 text-sm">
                <code className="font-mono text-xs text-text">{response.status}</code>
                <span className="text-text-muted">{response.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
