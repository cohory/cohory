import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { isBlockedAddress } from "./address";

export type EgressBlockReason = "scheme" | "credentials" | "private_address" | "redirects";

export class EgressBlockedError extends Error {
  readonly code = "egress_blocked";

  constructor(readonly reason: EgressBlockReason) {
    super(`outbound request refused: ${reason}`);
    this.name = "EgressBlockedError";
  }
}

export class EgressTimeoutError extends Error {
  readonly code = "egress_timeout";

  constructor() {
    super("outbound request timed out");
    this.name = "EgressTimeoutError";
  }
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type LookupAll = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface EgressOptions {
  readonly allowPrivateHosts?: readonly string[];
  readonly lookup?: LookupAll;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRedirects?: number;
  readonly beforeConnect?: (address: string) => void;
}

export interface EgressRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface EgressResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly truncated: boolean;
}

export type Egress = (request: EgressRequest) => Promise<EgressResponse>;

const defaultLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

function checkUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EgressBlockedError("scheme");
  }
  if (url.username || url.password) {
    throw new EgressBlockedError("credentials");
  }
}

function pinnedLookup(
  host: string,
  allowPrivate: boolean,
  lookupAll: LookupAll,
  beforeConnect: ((address: string) => void) | undefined,
): LookupFunction {
  return (hostname, options, callback) => {
    const done = callback as (
      error: Error | null,
      address: string | readonly ResolvedAddress[],
      family?: number,
    ) => void;
    const resolve = async (): Promise<ResolvedAddress> => {
      const literal = isIP(host);
      const addresses = literal ? [{ address: host, family: literal }] : await lookupAll(hostname);
      if (addresses.length === 0) {
        throw Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" });
      }
      if (!allowPrivate && addresses.some(({ address }) => isBlockedAddress(address))) {
        throw new EgressBlockedError("private_address");
      }
      const [chosen] = addresses;
      if (!chosen) {
        throw new EgressBlockedError("private_address");
      }
      beforeConnect?.(chosen.address);
      return chosen;
    };
    resolve().then(
      (chosen) => {
        if (options.all) {
          done(null, [chosen]);
        } else {
          done(null, chosen.address, chosen.family);
        }
      },
      (error: unknown) => done(error instanceof Error ? error : new Error("lookup failed"), ""),
    );
  };
}

function headersOf(response: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) {
      result[name] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return result;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export function createEgress(options: EgressOptions = {}): Egress {
  const allowed = new Set((options.allowPrivateHosts ?? []).map((host) => host.toLowerCase()));
  const lookupAll = options.lookup ?? defaultLookup;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxResponseBytes ?? 64 * 1024;
  const maxRedirects = options.maxRedirects ?? 0;

  function once(url: URL, request: EgressRequest): Promise<EgressResponse> {
    checkUrl(url);
    const host = bareHost(url);
    const allowPrivate = allowed.has(host);
    if (!allowPrivate && isIP(host) && isBlockedAddress(host)) {
      return Promise.reject(new EgressBlockedError("private_address"));
    }
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const requestOptions: RequestOptions = {
      method: request.method,
      headers: {
        ...request.headers,
        ...(request.body === undefined
          ? {}
          : { "content-length": String(Buffer.byteLength(request.body)) }),
      },
      lookup: pinnedLookup(host, allowPrivate, lookupAll, options.beforeConnect),
      agent: false,
    };
    return new Promise<EgressResponse>((resolve, reject) => {
      const outgoing = send(url, requestOptions, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const finish = () => {
          clearTimeout(timer);
          resolve({
            status: response.statusCode ?? 0,
            url: url.toString(),
            headers: headersOf(response),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        };
        response.on("data", (chunk: Buffer) => {
          if (truncated) {
            return;
          }
          const room = maxBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            size = maxBytes;
            truncated = true;
            response.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!truncated) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
      const timer = setTimeout(() => outgoing.destroy(new EgressTimeoutError()), timeoutMs);
      outgoing.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      outgoing.end(request.body);
    });
  }

  return async (request) => {
    let url = new URL(request.url);
    let current = request;
    for (let hop = 0; ; hop += 1) {
      const response = await once(url, current);
      const location = response.headers.location;
      if (maxRedirects === 0 || !redirectStatuses.has(response.status) || !location) {
        return response;
      }
      if (hop >= maxRedirects) {
        throw new EgressBlockedError("redirects");
      }
      url = new URL(location, url);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && current.method === "POST")
      ) {
        current = { url: url.toString(), method: "GET", headers: current.headers };
      }
    }
  };
}

export function egressOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly allowPrivateHosts: readonly string[] } {
  return {
    allowPrivateHosts: (env.EGRESS_ALLOW_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  };
}
