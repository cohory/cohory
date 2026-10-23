import { createServer, type IncomingMessage } from "node:http";

export interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly idempotencyKey: string | null;
  readonly account: string | null;
  readonly stripeVersion: string | null;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function withStripeServer(
  respond: Record<string, unknown>,
  fn: (baseUrl: string, captured: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const header = (name: string) => {
        const value = request.headers[name];
        return typeof value === "string" ? value : null;
      };
      captured.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body,
        idempotencyKey: header("idempotency-key"),
        account: header("stripe-account"),
        stripeVersion: header("stripe-version"),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(respond));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server has no port");
  }
  const { port } = address;
  try {
    await fn(`http://127.0.0.1:${port}`, captured);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
