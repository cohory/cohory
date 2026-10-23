import { isDeletionPending, type Auth } from "@cohory/auth";
import type { Actor } from "@cohory/authz";
import type { MiddlewareHandler } from "hono";

export interface SessionUser {
  readonly userId: string;
  readonly signedInAt?: Date;
}

export type SessionResolver = (headers: Headers) => Promise<SessionUser | null>;

export interface ActorVariables {
  actor: Actor;
}

export function betterAuthSessionResolver(auth: Auth): SessionResolver {
  return async (headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session || isDeletionPending(session.user)) {
      return null;
    }
    return { userId: session.user.id, signedInAt: new Date(session.session.createdAt) };
  };
}

export function resolveActor(
  getResolver: () => SessionResolver,
): MiddlewareHandler<{ Variables: ActorVariables }> {
  return async (c, next) => {
    if (c.var.actor) {
      await next();
      return;
    }
    const session = await getResolver()(c.req.raw.headers);
    c.set(
      "actor",
      session ? { kind: "user", userId: session.userId, platformAdmin: false } : { kind: "guest" },
    );
    await next();
  };
}
