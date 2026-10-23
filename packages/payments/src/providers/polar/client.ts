import { z } from "zod";

import { ProviderRejectedError } from "../../errors";

export const polarProductionUrl = "https://api.polar.sh";
export const polarSandboxUrl = "https://sandbox-api.polar.sh";

export interface PolarClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch: typeof fetch;
}

export type QueryValue = string | number | boolean;

export interface PolarClient {
  get<S extends z.ZodType>(
    schema: S,
    path: string,
    query?: Readonly<Record<string, QueryValue>>,
  ): Promise<z.output<S>>;
  send<S extends z.ZodType>(
    schema: S,
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
  ): Promise<z.output<S>>;
  remove(path: string): Promise<void>;
}

const errorBodySchema = z.looseObject({ error: z.string().optional() });

async function rejection(response: Response): Promise<ProviderRejectedError> {
  const body = errorBodySchema.safeParse(await response.json().catch(() => null));
  return new ProviderRejectedError(
    "Polar",
    response.status,
    body.success ? (body.data.error ?? null) : null,
  );
}

export function createPolarClient(options: PolarClientOptions): PolarClient {
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await options.fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw await rejection(response);
    }
    return response;
  }

  return {
    async get(schema, path, query = {}) {
      const params = new URLSearchParams(
        Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]),
      ).toString();
      const response = await call("GET", params ? `${path}?${params}` : path);
      return schema.parse(await response.json());
    },
    async send(schema, method, path, body) {
      const response = await call(method, path, body);
      return schema.parse(await response.json());
    },
    async remove(path) {
      await call("DELETE", path);
    },
  };
}
