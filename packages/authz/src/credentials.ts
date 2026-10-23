import { matrix, type Resource, type RoleRules } from "./matrix";
import type { Scope } from "./scopes";
import type { ApiCredential, CommunityRole, PolicyAction } from "./types";

export const approvalCategories = [
  "money",
  "payment_connection",
  "role",
  "removal",
  "deletion",
  "data_export",
  "data_import",
  "settings",
  "publishing",
  "purchase",
] as const;

export type ApprovalCategory = (typeof approvalCategories)[number];

export const approvalActions: Readonly<Partial<Record<PolicyAction, ApprovalCategory>>> = {
  "payment.refund": "money",
  "payment.edit_plan": "money",
  "payment.link_subscriptions": "money",
  "membership.grant_comp": "money",
  "payment.connect": "payment_connection",
  "membership.change_role": "role",
  "membership.assign_admin": "role",
  "membership.remove": "removal",
  "membership.ban": "removal",
  "post.delete": "deletion",
  "comment.delete": "deletion",
  "course.delete": "deletion",
  "lesson.delete": "deletion",
  "event.delete": "deletion",
  "export.create": "data_export",
  "export.members": "data_export",
  "migration.export": "data_export",
  "audit_log.export": "data_export",
  "webhook.manage": "data_export",
  "migration.import": "data_import",
  "migration.import_members": "data_import",
  "settings.custom_domain": "settings",
  "settings.update": "settings",
  "appearance.update": "settings",
  "course.publish": "publishing",
  "course.publish_agent_version": "publishing",
  "lesson.publish": "publishing",
  "post.email_all": "publishing",
  "payment.purchase": "purchase",
};

const proposalScopes: Readonly<Record<ApprovalCategory, Scope>> = {
  money: "payments:read",
  payment_connection: "payments:read",
  role: "members:moderate",
  removal: "members:moderate",
  deletion: "settings:read",
  data_export: "settings:read",
  data_import: "settings:read",
  settings: "settings:read",
  publishing: "posts:write",
  purchase: "courses:read",
};

export function proposalScope(action: PolicyAction, routeScope: Scope | null): Scope | null {
  if (routeScope !== null) return routeScope;
  const category = approvalActions[action];
  return category ? proposalScopes[category] : null;
}

export const nonGrantableActions: ReadonlySet<PolicyAction> = new Set<PolicyAction>([
  "payment.connect",
  "payment.refund",
  "payment.edit_plan",
  "payment.purchase",
  "membership.assign_admin",
  "community.transfer_ownership",
  "community.change_slug",
  "community.delete",
  "settings.custom_domain",
  "export.create",
  "migration.export",
  "migration.import",
  "migration.import_members",
  "audit_log.export",
  "api_token.create_own",
  "api_token.read_all",
  "api_token.manage_all",
  "agent.read",
  "agent.create",
  "agent.create_own",
  "agent.manage",
  "approval.read",
  "approval.decide",
  "course.manage_agent_access",
  "delegation.create",
  "delegation.manage",
  "delegation.read_all",
  "review.create",
  "review.edit",
  "review.delete",
  "review.report",
  "review.reply",
  "review.hide",
  "creator_feedback.answer",
]);

export const agentForbiddenActions: ReadonlySet<PolicyAction> = new Set<PolicyAction>([
  "community.archive",
  "community.delete",
  "community.transfer_ownership",
  "community.change_slug",
  "creator_feedback.answer",
]);

export type CredentialDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "approval_required"; readonly category: ApprovalCategory }
  | { readonly kind: "not_allowed_for_agents" }
  | { readonly kind: "not_grantable" };

export function credentialDecision(
  credential: ApiCredential,
  action: PolicyAction,
): CredentialDecision {
  if (credential.type === "agent") {
    if (agentForbiddenActions.has(action)) {
      return { kind: "not_allowed_for_agents" };
    }
    const category = approvalActions[action];
    if (category) {
      return { kind: "approval_required", category };
    }
  }
  if (nonGrantableActions.has(action)) {
    return { kind: "not_grantable" };
  }
  return { kind: "allowed" };
}

export function roleMayPerform(role: CommunityRole | null, action: PolicyAction): boolean {
  const [resource, name] = action.split(".") as [Resource, string];
  const actions: Readonly<Record<string, RoleRules>> = matrix[resource];
  const rule = actions[name]?.[role ?? "guest"];
  return rule !== undefined && rule !== "deny";
}
