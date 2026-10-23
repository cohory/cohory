import { getEntitlementsService } from "@cohory/api/services";
import { ForbiddenError } from "@cohory/authz";
import { EntitlementsError, type LicenseTerms } from "@cohory/entitlements";

import type { FullCommunityPage } from "../communities/load";
import {
  delegationItem,
  submissionItem,
  summaryItem,
  type DelegationItem,
  type SubmissionItem,
  type SummaryItem,
} from "./views";

export interface CourseAgentPanelData {
  readonly courseId: string;
  readonly allowAgentAccess: boolean;
  readonly license: LicenseTerms;
  readonly canManage: boolean;
  readonly canDelegate: boolean;
  readonly agents: readonly { readonly id: string; readonly name: string }[];
  readonly delegations: readonly DelegationItem[];
  readonly submissions: readonly SubmissionItem[];
  readonly summary: readonly SummaryItem[] | null;
}

function hidden(error: unknown): boolean {
  return error instanceof ForbiddenError || error instanceof EntitlementsError;
}

export async function loadCourseAgentPanel(
  page: FullCommunityPage,
  courseId: string,
): Promise<CourseAgentPanelData | null> {
  if (page.actor.kind !== "user" || page.role === null) {
    return null;
  }
  const service = getEntitlementsService();
  try {
    const access = await service.getCourseAgentAccess(page.actor, page.community.id, courseId);
    const [submissions, summary] = await Promise.all([
      service.listSubmissions(page.actor, page.community.id, courseId),
      access.canManage
        ? service.submissionSummary(page.actor, page.community.id, courseId)
        : Promise.resolve(null),
    ]);
    return {
      courseId,
      allowAgentAccess: access.settings.allowAgentAccess,
      license: access.settings.license,
      canManage: access.canManage,
      canDelegate: access.canDelegate,
      agents: access.agents,
      delegations: access.delegations.map(delegationItem),
      submissions: submissions.map(submissionItem),
      summary: summary ? summary.map(summaryItem) : null,
    };
  } catch (error: unknown) {
    if (hidden(error)) return null;
    throw error;
  }
}
