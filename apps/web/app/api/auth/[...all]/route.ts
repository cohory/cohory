import { getRateLimiter } from "@cohory/rate-limit";

import { limitAuthRequest } from "../../../../lib/auth/rate-limit";
import { getAppAuth } from "../../../../lib/auth/instance";

function handler(request: Request): Promise<Response> {
  const refused = limitAuthRequest(request, getRateLimiter());
  return refused ? Promise.resolve(refused) : getAppAuth().handler(request);
}

export { handler as GET, handler as POST };
