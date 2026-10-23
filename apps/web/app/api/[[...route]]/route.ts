import { api } from "@cohory/api";

import { notificationUnsubscribeRedirect } from "../../../lib/email/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handler(request: Request): Response | Promise<Response> {
  return api.fetch(request);
}

function get(request: Request): Response | Promise<Response> {
  return notificationUnsubscribeRedirect(request) ?? api.fetch(request);
}

export { handler as DELETE, get as GET, handler as PATCH, handler as POST, handler as PUT };
