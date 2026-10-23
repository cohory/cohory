import { credentialDecision, type CredentialDecision } from "./credentials";
import { AgentNotAllowedError, ApprovalRequiredError, ForbiddenError } from "./errors";
import { matrix, type ActionOf, type Resource, type Role, type RoleRules } from "./matrix";
import type { Actor, PolicyAction, PolicyContext, Rule } from "./types";

function rolesOf(actor: Actor, context: PolicyContext): Role[] {
  if (actor.kind === "guest") {
    return ["guest"];
  }
  const communityRole: Role = context.role ?? "guest";
  return actor.platformAdmin ? ["platform_admin", communityRole] : [communityRole];
}

function satisfies(rule: Rule, actor: Actor, context: PolicyContext): boolean {
  const isPublic = context.communityPrivacy === "public";
  const target = context.target;
  switch (rule) {
    case "allow":
      return true;
    case "deny":
      return false;
    case "signed_in":
      return actor.kind === "user";
    case "public_community":
      return isPublic;
    case "signed_in_public_community":
      return actor.kind === "user" && isPublic;
    case "own":
      return context.ownsResource === true;
    case "entitled":
      return context.entitled === true;
    case "entitled_or_public_community":
      return context.entitled === true || isPublic;
    case "target_member":
      return target?.role === "member" && !target.isSelf;
    case "target_member_or_moderator":
      return (target?.role === "member" || target?.role === "moderator") && !target.isSelf;
    case "target_not_owner":
      return target !== undefined && target.role !== "owner" && !target.isSelf;
    case "target_not_self":
      return target !== undefined && !target.isSelf;
  }
}

function decisionFor<R extends Resource>(
  actor: Actor,
  action: ActionOf<R>,
  resource: R,
): CredentialDecision {
  if (actor.kind !== "user" || !actor.credential) {
    return { kind: "allowed" };
  }
  return credentialDecision(actor.credential, `${resource}.${action}` as PolicyAction);
}

function roleAllows<R extends Resource>(
  actor: Actor,
  action: ActionOf<R>,
  resource: R,
  context: PolicyContext,
): boolean {
  const actions: Readonly<Record<string, RoleRules>> = matrix[resource];
  const roleRules = actions[action];
  if (!roleRules) {
    return false;
  }
  return rolesOf(actor, context).some((role) => satisfies(roleRules[role], actor, context));
}

export function can<R extends Resource>(
  actor: Actor,
  action: ActionOf<R>,
  resource: R,
  context: PolicyContext = {},
): boolean {
  return (
    decisionFor(actor, action, resource).kind === "allowed" &&
    roleAllows(actor, action, resource, context)
  );
}

export function assertCan<R extends Resource>(
  actor: Actor,
  action: ActionOf<R>,
  resource: R,
  context: PolicyContext = {},
): void {
  if (!roleAllows(actor, action, resource, context)) {
    throw new ForbiddenError(action, resource);
  }
  const decision = decisionFor(actor, action, resource);
  if (decision.kind === "approval_required") {
    throw new ApprovalRequiredError(action, resource, decision.category);
  }
  if (decision.kind === "not_allowed_for_agents") {
    throw new AgentNotAllowedError(action, resource);
  }
  if (decision.kind === "not_grantable") {
    throw new ForbiddenError(action, resource);
  }
}
