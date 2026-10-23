import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createEgress,
  EgressBlockedError,
  EgressTimeoutError,
  egressOptionsFromEnv,
  type LookupAll,
} from "./request";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let port: number;
let handler: Handler = (_req, res) => res.end("ok");
const received: { method?: string; body: string; headers: IncomingMessage["headers"] }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      received.push({ method: req.method, body, headers: req.headers });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fakeLookup(table: Record<string, readonly string[]>): LookupAll {
  return vi.fn(async (hostname: string) => {
    const addresses = table[hostname];
    if (!addresses) {
      throw Object.assign(new Error(`not found ${hostname}`), { code: "ENOTFOUND" });
    }
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
}

describe("createEgress", () => {
  it("refuses loopback, private, link local, and metadata addresses by default", async () => {
    const egress = createEgress();
    for (const url of [
      `http://127.0.0.1:${port}/`,
      "http://10.1.2.3/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[fd00:ec2::254]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      await expect(egress({ url, method: "GET" })).rejects.toBeInstanceOf(EgressBlockedError);
    }
  });

  it("refuses a host name that resolves to a private address", async () => {
    const lookup = fakeLookup({ "intranet.test": ["192.168.0.10"] });
    const egress = createEgress({ lookup });
    await expect(egress({ url: "http://intranet.test/", method: "GET" })).rejects.toMatchObject({
      name: "EgressBlockedError",
      reason: "private_address",
    });
  });

  it("refuses when any resolved address is private, so one public record cannot hide another", async () => {
    const lookup = fakeLookup({ "mixed.test": ["93.184.215.14", "127.0.0.1"] });
    await expect(
      createEgress({ lookup })({ url: "http://mixed.test/", method: "GET" }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("connects to the address it checked, so a DNS rebinding answer cannot swap it", async () => {
    let calls = 0;
    const lookup: LookupAll = async () => {
      calls += 1;
      return calls === 1
        ? [{ address: "93.184.215.14", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    };
    const connected: string[] = [];
    const before = received.length;
    const egress = createEgress({
      lookup,
      beforeConnect: (address) => {
        connected.push(address);
        throw new Error("offline in tests");
      },
    });
    await expect(egress({ url: "http://rebind.test/", method: "GET" })).rejects.toThrow(
      "offline in tests",
    );
    await expect(egress({ url: "http://rebind.test/", method: "GET" })).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    expect(connected).toEqual(["93.184.215.14"]);
    expect(received.length).toBe(before);
    expect(calls).toBe(2);
  });

  it("refuses schemes other than http and https and URLs with credentials", async () => {
    const egress = createEgress();
    await expect(egress({ url: "file:///etc/passwd", method: "GET" })).rejects.toMatchObject({
      reason: "scheme",
    });
    await expect(egress({ url: "ftp://example.com/", method: "GET" })).rejects.toMatchObject({
      reason: "scheme",
    });
    await expect(
      egress({ url: "https://user:secret@example.com/", method: "GET" }),
    ).rejects.toMatchObject({ reason: "credentials" });
  });

  it("posts to an allowed host and returns status, headers, and a bounded body", async () => {
    handler = (_req, res) => {
      res.writeHead(202, { "x-reply": "yes" });
      res.end("a".repeat(5000));
    };
    const egress = createEgress({ allowPrivateHosts: ["127.0.0.1"], maxResponseBytes: 100 });
    const response = await egress({
      url: `http://127.0.0.1:${port}/hook`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(response.status).toBe(202);
    expect(response.headers["x-reply"]).toBe("yes");
    expect(response.body.length).toBe(100);
    expect(response.truncated).toBe(true);
    expect(received.at(-1)).toMatchObject({ method: "POST", body: '{"a":1}' });
  });

  it("follows a redirect only to an allowed address and checks every hop", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: "http://metadata.test/latest/meta-data/" });
      res.end();
    };
    const lookup = fakeLookup({ "metadata.test": ["169.254.169.254"] });
    const egress = createEgress({ allowPrivateHosts: ["127.0.0.1"], lookup, maxRedirects: 3 });
    await expect(
      egress({ url: `http://127.0.0.1:${port}/start`, method: "GET" }),
    ).rejects.toMatchObject({ name: "EgressBlockedError", reason: "private_address" });
  });

  it("returns the redirect response itself when redirects are not followed", async () => {
    handler = (_req, res) => {
      res.writeHead(307, { location: "http://10.0.0.1/" });
      res.end();
    };
    const egress = createEgress({ allowPrivateHosts: ["127.0.0.1"] });
    const response = await egress({ url: `http://127.0.0.1:${port}/`, method: "POST", body: "x" });
    expect(response.status).toBe(307);
  });

  it("stops after the redirect limit", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/again` });
      res.end();
    };
    const egress = createEgress({ allowPrivateHosts: ["127.0.0.1"], maxRedirects: 2 });
    await expect(egress({ url: `http://127.0.0.1:${port}/`, method: "GET" })).rejects.toMatchObject(
      { reason: "redirects" },
    );
  });

  it("times out a slow receiver", async () => {
    handler = () => undefined;
    const egress = createEgress({ allowPrivateHosts: ["127.0.0.1"], timeoutMs: 100 });
    await expect(
      egress({ url: `http://127.0.0.1:${port}/slow`, method: "GET" }),
    ).rejects.toBeInstanceOf(EgressTimeoutError);
  });
});

describe("egressOptionsFromEnv", () => {
  it("reads the private host override as an exact list of host names", () => {
    expect(
      egressOptionsFromEnv({ EGRESS_ALLOW_PRIVATE_HOSTS: " 127.0.0.1, Receiver.Local ,," }),
    ).toEqual({ allowPrivateHosts: ["127.0.0.1", "receiver.local"] });
    expect(egressOptionsFromEnv({})).toEqual({ allowPrivateHosts: [] });
  });
});
