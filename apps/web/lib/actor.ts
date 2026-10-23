import type { Session } from "@cohory/auth";
import type { Actor } from "@cohory/authz";

export function actorFor(session: Session | null): Actor {
  return session
    ? { kind: "user", userId: session.user.id, platformAdmin: false }
    : { kind: "guest" };
}
