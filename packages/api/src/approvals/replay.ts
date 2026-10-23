import { AsyncLocalStorage } from "node:async_hooks";
import type { ApprovalRecordedInput } from "@cohory/agents/approvals";
import { runWithAuditSource } from "@cohory/db";

import type { SessionResolver, SessionUser } from "../middleware/session";

export interface ReplayRequest {
  readonly userId: string;
  readonly agentId: string | null;
  readonly method: string;
  readonly path: string;
  readonly input: ApprovalRecordedInput;
}

export type Replay = (request: ReplayRequest) => Promise<Response>;

export interface ReplayTarget {
  request(path: string, init: RequestInit): Response | Promise<Response>;
}

const replayUser = new AsyncLocalStorage<SessionUser>();

export const replaySessionResolver: SessionResolver = async () => replayUser.getStore() ?? null;

export function createReplay(target: () => ReplayTarget): Replay {
  return async ({ userId, agentId, method, path, input }) => {
    const url = new URL(path, "http://replay.invalid");
    for (const [name, value] of Object.entries(input.query)) {
      url.searchParams.set(name, value);
    }
    const hasBody = input.body !== null && input.body !== undefined;
    const init: RequestInit = {
      method,
      headers: hasBody ? { "content-type": "application/json" } : {},
      ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
    };
    return replayUser.run({ userId }, () =>
      runWithAuditSource({ actorType: "user", via: "web", tokenId: null, agentId }, () =>
        Promise.resolve(target().request(`${url.pathname}${url.search}`, init)),
      ),
    );
  };
}
