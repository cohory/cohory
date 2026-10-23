import { getStorage } from "@cohory/storage";

import {
  contentDisposition,
  resolveImageAccess,
  type ImageAccess,
} from "../../../../lib/posts/image-access";
import { imageAccessDeps } from "../../../../lib/posts/image-access-server";

function cacheControl(access: Exclude<ImageAccess, { kind: "denied" }>): string {
  if (access.kind !== "public") {
    return "private, max-age=300, must-revalidate";
  }
  return access.immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600";
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request, context: RouteContext<"/api/uploads/[...key]">) {
  const { key: segments } = await context.params;
  const requestedName = new URL(request.url).searchParams.get("name");
  const access = await resolveImageAccess(segments.join("/"), imageAccessDeps, { requestedName });
  if (access.kind === "denied") {
    return notFound();
  }

  const object = await getStorage().get(access.key);
  if (!object) {
    return notFound();
  }

  const headers = new Headers({
    "Content-Type": object.contentType,
    "Cache-Control": cacheControl(access),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (access.kind !== "public") {
    headers.set("Vary", "Cookie");
  }
  if (access.kind === "attachment") {
    headers.set("Content-Disposition", contentDisposition(access.filename));
  }
  if (object.size > 0) {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { headers });
}
