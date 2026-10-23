import { z } from "zod";

export interface FieldView {
  readonly name: string;
  readonly location: string | null;
  readonly type: string;
  readonly required: boolean;
  readonly description: string | null;
}

export interface OperationView {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string | null;
  readonly scope: string | null;
  readonly parameters: readonly FieldView[];
  readonly body: { readonly contentType: string; readonly fields: readonly FieldView[] } | null;
  readonly responses: readonly { readonly status: string; readonly description: string }[];
}

export interface TagView {
  readonly name: string;
  readonly anchor: string;
  readonly operations: readonly OperationView[];
}

export interface ReferenceView {
  readonly serverUrl: string | null;
  readonly tags: readonly TagView[];
}

const methods = ["get", "post", "put", "patch", "delete"] as const;

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: z.unknown().optional(),
});

const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: z
    .object({ content: z.record(z.string(), z.object({ schema: z.unknown().optional() })) })
    .optional(),
  responses: z.record(z.string(), z.object({ description: z.string().optional() })).optional(),
  "x-cohory": z.object({ scope: z.string().nullable().optional() }).optional(),
});

const documentSchema = z.object({
  servers: z.array(z.object({ url: z.string() })).optional(),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
  components: z.object({ schemas: z.record(z.string(), z.unknown()).optional() }).optional(),
});

const jsonSchema = z
  .object({
    $ref: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    enum: z.array(z.unknown()).optional(),
    items: z.unknown().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    description: z.string().optional(),
    anyOf: z.array(z.unknown()).optional(),
    oneOf: z.array(z.unknown()).optional(),
  })
  .loose();

type JsonSchema = z.infer<typeof jsonSchema>;

function refName(ref: string): string {
  return ref.split("/").at(-1) ?? ref;
}

function typeLabel(raw: unknown): string {
  const parsed = jsonSchema.safeParse(raw);
  if (!parsed.success) return "any";
  const schema = parsed.data;
  if (schema.$ref) return refName(schema.$ref);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return variants.map(typeLabel).join(" | ");
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  return (
    types.map((type) => (type === "array" ? `${typeLabel(schema.items)}[]` : type)).join(" | ") ||
    "any"
  );
}

function resolve(raw: unknown, components: Record<string, unknown>): JsonSchema | null {
  const parsed = jsonSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.$ref) return resolve(components[refName(parsed.data.$ref)], components);
  return parsed.data;
}

function bodyFields(raw: unknown, components: Record<string, unknown>): FieldView[] {
  const schema = resolve(raw, components);
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, property]) => ({
    name,
    location: null,
    type: typeLabel(property),
    required: required.has(name),
    description: resolve(property, components)?.description ?? null,
  }));
}

function anchorFor(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildReference(raw: unknown): ReferenceView {
  const document = documentSchema.parse(raw);
  const components = document.components?.schemas ?? {};
  const tags = new Map<string, OperationView[]>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const parsed = operationSchema.safeParse(item[method]);
      if (!parsed.success) continue;
      const operation = parsed.data;
      const content = Object.entries(operation.requestBody?.content ?? {})[0];
      const view: OperationView = {
        id: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.operationId,
        description: operation.description ?? null,
        scope: operation["x-cohory"]?.scope ?? null,
        parameters: (operation.parameters ?? []).map((parameter) => ({
          name: parameter.name,
          location: parameter.in,
          type: typeLabel(parameter.schema),
          required: parameter.required ?? false,
          description: parameter.description ?? null,
        })),
        body: content
          ? { contentType: content[0], fields: bodyFields(content[1].schema, components) }
          : null,
        responses: Object.entries(operation.responses ?? {})
          .map(([status, response]) => ({ status, description: response.description ?? "" }))
          .sort((a, b) => a.status.localeCompare(b.status)),
      };
      const tag = operation.tags?.[0] ?? "Other";
      tags.set(tag, [...(tags.get(tag) ?? []), view]);
    }
  }
  return {
    serverUrl: document.servers?.[0]?.url ?? null,
    tags: [...tags.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, operations]) => ({ name, anchor: anchorFor(name), operations })),
  };
}
