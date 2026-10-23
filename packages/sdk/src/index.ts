import createFetchClient, { type Client } from "openapi-fetch";

import type { paths } from "./schema";

export type { components, operations, paths } from "./schema";

export interface CohoryClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly headers?: Readonly<Record<string, string>>;
}

export type CohoryClient = Client<paths>;

export function createClient(options: CohoryClientOptions): CohoryClient {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  return createFetchClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    headers,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
