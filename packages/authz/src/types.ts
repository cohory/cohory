import type { ActionOf, Resource } from "./matrix";
import type { Scope } from "./scopes";

export const communityRoles = ["owner", "admin", "moderator", "member"] as const;

export type CommunityRole = (typeof communityRoles)[number];

export const actorVias = ["web", "api", "mcp", "job"] as const;

export type ActorVia = (typeof actorVias)[number];

export interface ApiCredential {
  readonly type: "user" | "agent";
  readonly tokenId: string;
  readonly agentId: string | null;
  readonly communityId: string;
  readonly scopes: readonly Scope[];
  readonly via: Extract<ActorVia, "api" | "mcp">;
}

export interface UserActor {
  readonly kind: "user";
  readonly userId: string;
  readonly platformAdmin: boolean;
  readonly credential?: ApiCredential;
}

export type Actor = { readonly kind: "guest" } | UserActor;

export type ApiActor = UserActor & { readonly credential: ApiCredential };

export type PolicyAction = { [R in Resource]: `${R}.${ActionOf<R>}` }[Resource];

export type CommunityPrivacy = "public" | "private";

export interface PolicyTarget {
  readonly role: CommunityRole;
  readonly isSelf: boolean;
}

export interface PolicyContext {
  readonly role?: CommunityRole | null;
  readonly communityPrivacy?: CommunityPrivacy;
  readonly ownsResource?: boolean;
  readonly entitled?: boolean;
  readonly target?: PolicyTarget;
}

export type Rule =
  | "allow"
  | "deny"
  | "signed_in"
  | "public_community"
  | "signed_in_public_community"
  | "own"
  | "entitled"
  | "entitled_or_public_community"
  | "target_member"
  | "target_member_or_moderator"
  | "target_not_owner"
  | "target_not_self";
