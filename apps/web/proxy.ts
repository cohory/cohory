import { findMovedSlug } from "@cohory/communities/moved-slug";
import { NextResponse, type NextRequest } from "next/server";

import { movedCommunityLocation } from "./lib/communities/moved-slug";
import { contentSecurityPolicy, createNonce } from "./lib/content-security-policy";

const followableMethods = new Set(["GET", "HEAD"]);

async function movedCommunity(request: NextRequest): Promise<NextResponse | null> {
  if (!followableMethods.has(request.method) || request.headers.has("next-action")) {
    return null;
  }
  const location = await movedCommunityLocation(request.nextUrl, findMovedSlug);
  return location ? NextResponse.redirect(new URL(location, request.nextUrl), 308) : null;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const moved = await movedCommunity(request);
  if (moved) {
    return moved;
  }
  const nonce = createNonce();
  const policy = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
