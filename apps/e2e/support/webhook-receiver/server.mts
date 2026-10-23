import { createServer } from "node:http";

// A webhook receiver for the end to end stack. It records every delivery with its headers
// and raw body so the tests can check the signature with an independent library. Runs with
// Node type stripping inside the app image (see compose.e2e.yml).

interface Delivery {
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly receivedAt: string;
}

const port = Number(process.env.WEBHOOK_RECEIVER_PORT ?? 12113);
const deliveries: Delivery[] = [];

createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const url = new URL(request.url ?? "/", "http://receiver.invalid");
    if (request.method === "GET" && url.pathname === "/__health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    if (request.method === "GET" && url.pathname === "/__deliveries") {
      const path = url.searchParams.get("path");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(deliveries.filter((entry) => !path || entry.path === path)));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[name] = value;
    }
    deliveries.push({
      path: url.pathname,
      headers,
      body: Buffer.concat(chunks).toString("utf8"),
      receivedAt: new Date().toISOString(),
    });
    response.writeHead(204);
    response.end();
  });
}).listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", msg: "webhook receiver listening", port }));
});
