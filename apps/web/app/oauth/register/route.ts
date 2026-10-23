import { oauthApp } from "@cohory/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handler(request: Request): Response | Promise<Response> {
  return oauthApp.fetch(request);
}

export { handler as OPTIONS, handler as POST };
