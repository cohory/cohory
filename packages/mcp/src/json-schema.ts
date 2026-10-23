export type JsonObject = { [key: string]: unknown };

const componentPrefix = "#/components/schemas/";

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function objectAt(value: unknown, ...keys: string[]): JsonObject | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isJsonObject(current)) return null;
    current = current[key];
  }
  return isJsonObject(current) ? current : null;
}

export function componentName(schema: unknown): string | null {
  if (!isJsonObject(schema) || typeof schema.$ref !== "string") return null;
  return schema.$ref.startsWith(componentPrefix) ? schema.$ref.slice(componentPrefix.length) : null;
}

export class SchemaCollector {
  readonly #components: JsonObject;
  readonly #defs = new Map<string, unknown>();

  constructor(components: JsonObject) {
    this.#components = components;
  }

  component(name: string): JsonObject | null {
    const found = this.#components[name];
    return isJsonObject(found) ? found : null;
  }

  resolve(schema: unknown): unknown {
    const name = componentName(schema);
    return name ? this.component(name) : schema;
  }

  use(schema: unknown): unknown {
    if (Array.isArray(schema)) {
      return schema.map((item) => this.use(item));
    }
    if (!isJsonObject(schema)) {
      return schema;
    }
    const name = componentName(schema);
    if (name) {
      if (!this.#defs.has(name)) {
        this.#defs.set(name, null);
        this.#defs.set(name, this.use(this.component(name) ?? {}));
      }
      return { $ref: `#/$defs/${name}` };
    }
    const copy: JsonObject = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "example" || key === "examples") continue;
      copy[key] = this.use(value);
    }
    return copy;
  }

  withDefs(schema: JsonObject): JsonObject {
    if (this.#defs.size === 0) return schema;
    const names = [...this.#defs.keys()].sort();
    return {
      ...schema,
      $defs: Object.fromEntries(names.map((name) => [name, this.#defs.get(name)])),
    };
  }
}
