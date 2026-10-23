import { getMcpHandler } from "@cohory/mcp";

export const dynamic = "force-dynamic";

function handler(request: Request): Promise<Response> {
  return getMcpHandler()(request);
}

export { handler as DELETE, handler as GET, handler as POST };
