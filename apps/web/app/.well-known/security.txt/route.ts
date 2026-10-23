import { getLegalConfig } from "@cohory/config/legal";
import { getPlatformConfig } from "@cohory/config/platform";

import { securityTxt } from "../../../lib/legal/security-txt";

export function GET(): Response {
  const body = securityTxt(getLegalConfig(), getPlatformConfig().appUrl, new Date());
  if (!body) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
