import type { Actor } from "@cohory/authz";
import type { CommunityUsage } from "@cohory/fair-use";
import { getDb, type CommunityId } from "@cohory/db";
import { getStorage, type ImageUpload } from "@cohory/storage";

import { appearanceOperations, type BrandingKind } from "./appearance";
import {
  auditOperations,
  type AuditCsvExport,
  type AuditLogPage,
  type ListAuditLogInput,
  type ListOwnActivityInput,
} from "./audit";
import { createRuntime, parseInput, type ManageServiceDeps } from "./context";
import type { GalleryItemView } from "../gallery";
import { exportOperations } from "./export";
import { galleryOperations } from "./gallery";
import { healthOperations, type CommunityHealth } from "./health";
import { inviteOperations } from "./invites";
import { joiningOperations, type JoinDecisionResult } from "./joining";
import { peopleOperations, type MemberChange } from "./people";
import type { ArchiveInput } from "./paid-exit";
import { createPostgresManageRepository } from "./postgres-repository";
import {
  updateGeneralInputSchema,
  type AssignableRole,
  type BulkMemberActionInput,
  type CreateInviteInput,
  type DecideJoinRequestsInput,
  type DeleteCommunityInput,
  type DecideJoinRequestInput,
  type ExportMembersInput,
  type ListManageMembersInput,
  type AddGalleryVideoInput,
  type ReorderGalleryInput,
  type UpdateGalleryItemInput,
  type RequestToJoinInput,
  type UpdateAboutInput,
  type UpdateAppearanceInput,
  type UpdateGeneralInput,
  type UpdateSettingsInput,
} from "./schemas";
import { settingsOperations, type CompletedDeletion, type DeleteOutcome } from "./settings";
import {
  setupChecklistOperations,
  type SetupChecklist,
  type SetupExternalFacts,
  type SetupMark,
} from "./setup-checklist";
import { slugOperations, type SlugStatusView } from "./slug";
import type { ChangeSlugInput } from "./slug-rules";
import type {
  AppearanceView,
  BulkResult,
  InviteLinkView,
  InvitePreview,
  JoinRequestQueue,
  JoinRequestStatusView,
  JoinStatusView,
  ManageMemberDetail,
  ManageMemberPage,
  ManageSettingsView,
  MembersCsvExport,
  OverviewStats,
  RedeemedInvite,
} from "./views";

export interface ManageService {
  getOverviewStats(actor: Actor, communityId: string): Promise<OverviewStats>;
  getCommunityHealth(actor: Actor, communityId: string): Promise<CommunityHealth>;
  getSetupChecklist(
    actor: Actor,
    communityId: string,
    external: SetupExternalFacts,
  ): Promise<SetupChecklist>;
  markSetupProgress(actor: Actor, communityId: string, mark: SetupMark): Promise<void>;
  getUsage(actor: Actor, communityId: string): Promise<CommunityUsage>;
  getSettings(actor: Actor, communityId: string): Promise<ManageSettingsView>;
  updateSettings(
    actor: Actor,
    communityId: string,
    input: UpdateSettingsInput,
  ): Promise<ManageSettingsView>;
  updateGeneral(
    actor: Actor,
    communityId: string,
    input: UpdateGeneralInput,
  ): Promise<ManageSettingsView>;
  setGamificationEnabled(
    actor: Actor,
    communityId: string,
    enabled: boolean,
  ): Promise<ManageSettingsView>;
  setReviewsEnabled(
    actor: Actor,
    communityId: string,
    enabled: boolean,
  ): Promise<ManageSettingsView>;
  updateLevelNames(
    actor: Actor,
    communityId: string,
    levelNames: readonly string[],
  ): Promise<ManageSettingsView>;
  getSlugStatus(actor: Actor, communityId: string): Promise<SlugStatusView>;
  changeSlug(actor: Actor, communityId: string, input: ChangeSlugInput): Promise<SlugStatusView>;
  transferOwnership(
    actor: Actor,
    communityId: string,
    newOwnerUserId: string,
  ): Promise<ManageSettingsView>;
  archiveCommunity(
    actor: Actor,
    communityId: string,
    input?: ArchiveInput,
  ): Promise<ManageSettingsView>;
  unarchiveCommunity(actor: Actor, communityId: string): Promise<ManageSettingsView>;
  deleteCommunity(
    actor: Actor,
    communityId: string,
    input?: DeleteCommunityInput,
  ): Promise<DeleteOutcome>;
  completeCommunityDeletion(communityId: CommunityId): Promise<CompletedDeletion>;

  getAppearance(communityId: string): Promise<AppearanceView>;
  updateAbout(actor: Actor, communityId: string, input: UpdateAboutInput): Promise<AppearanceView>;
  updateAppearance(
    actor: Actor,
    communityId: string,
    input: UpdateAppearanceInput,
  ): Promise<AppearanceView>;
  uploadBranding(
    actor: Actor,
    communityId: string,
    kind: BrandingKind,
    upload: ImageUpload,
  ): Promise<AppearanceView>;

  listGallery(communityId: string): Promise<GalleryItemView[]>;
  addGalleryImage(
    actor: Actor,
    communityId: string,
    upload: ImageUpload,
    altText?: string | null,
  ): Promise<GalleryItemView[]>;
  addGalleryVideo(
    actor: Actor,
    communityId: string,
    input: AddGalleryVideoInput,
  ): Promise<GalleryItemView[]>;
  updateGalleryItem(
    actor: Actor,
    communityId: string,
    itemId: string,
    input: UpdateGalleryItemInput,
  ): Promise<GalleryItemView[]>;
  reorderGallery(
    actor: Actor,
    communityId: string,
    input: ReorderGalleryInput,
  ): Promise<GalleryItemView[]>;
  removeGalleryItem(actor: Actor, communityId: string, itemId: string): Promise<GalleryItemView[]>;

  listMembersForManage(
    actor: Actor,
    communityId: string,
    input?: ListManageMembersInput,
  ): Promise<ManageMemberPage>;
  getMemberForManage(
    actor: Actor,
    communityId: string,
    userId: string,
  ): Promise<ManageMemberDetail>;
  changeRole(
    actor: Actor,
    communityId: string,
    userId: string,
    role: AssignableRole,
  ): Promise<MemberChange>;
  removeMember(actor: Actor, communityId: string, userId: string): Promise<MemberChange>;
  banMember(actor: Actor, communityId: string, userId: string): Promise<MemberChange>;
  unbanMember(actor: Actor, communityId: string, userId: string): Promise<MemberChange>;
  applyMemberAction(
    actor: Actor,
    communityId: string,
    input: BulkMemberActionInput,
  ): Promise<BulkResult>;

  createInviteLink(
    actor: Actor,
    communityId: string,
    input?: CreateInviteInput,
  ): Promise<InviteLinkView>;
  listInviteLinks(actor: Actor, communityId: string): Promise<InviteLinkView[]>;
  revokeInviteLink(actor: Actor, communityId: string, inviteId: string): Promise<InviteLinkView>;
  previewInvite(token: string): Promise<InvitePreview | null>;
  redeemInvite(actor: Actor, token: string): Promise<RedeemedInvite>;

  requestToJoin(
    actor: Actor,
    communityId: string,
    input?: RequestToJoinInput,
  ): Promise<JoinRequestStatusView>;
  getJoinStatus(actor: Actor, communityId: string): Promise<JoinStatusView>;
  listJoinRequests(actor: Actor, communityId: string): Promise<JoinRequestQueue>;
  countJoinRequests(actor: Actor, communityId: string): Promise<number>;
  approveJoinRequest(
    actor: Actor,
    communityId: string,
    requestId: string,
    input?: DecideJoinRequestInput,
  ): Promise<JoinDecisionResult>;
  decideJoinRequests(
    actor: Actor,
    communityId: string,
    input: DecideJoinRequestsInput,
  ): Promise<BulkResult>;
  declineJoinRequest(
    actor: Actor,
    communityId: string,
    requestId: string,
    input?: DecideJoinRequestInput,
  ): Promise<JoinDecisionResult>;

  exportMembersCsv(
    actor: Actor,
    communityId: string,
    input?: ExportMembersInput,
  ): Promise<MembersCsvExport>;

  listAuditLog(actor: Actor, communityId: string, input?: ListAuditLogInput): Promise<AuditLogPage>;
  listOwnActivity(
    actor: Actor,
    communityId: string,
    input?: ListOwnActivityInput,
  ): Promise<AuditLogPage>;
  exportAuditLogCsv(
    actor: Actor,
    communityId: string,
    input?: Omit<ListAuditLogInput, "cursor" | "limit">,
  ): Promise<AuditCsvExport>;
}

export function createManageService(deps: ManageServiceDeps): ManageService {
  const runtime = createRuntime(deps);
  const settings = settingsOperations(runtime);
  return {
    ...settings,
    updateGeneral: (actor, communityId, input) =>
      settings.updateSettings(actor, communityId, parseInput(updateGeneralInputSchema, input)),
    setGamificationEnabled: (actor, communityId, enabled) =>
      settings.updateSettings(actor, communityId, { gamificationEnabled: enabled }),
    setReviewsEnabled: (actor, communityId, enabled) =>
      settings.updateSettings(actor, communityId, { reviewsEnabled: enabled }),
    updateLevelNames: (actor, communityId, levelNames) =>
      settings.updateSettings(actor, communityId, { levelNames: [...levelNames] }),
    ...slugOperations(runtime),
    ...appearanceOperations(runtime),
    ...galleryOperations(runtime),
    ...peopleOperations(runtime),
    ...inviteOperations(runtime),
    ...joiningOperations(runtime),
    ...exportOperations(runtime),
    ...auditOperations(runtime),
    ...healthOperations(runtime),
    ...setupChecklistOperations(runtime),
  };
}

let defaultService: ManageService | undefined;

export function getManageService(): ManageService {
  defaultService ??= createManageService({
    repo: createPostgresManageRepository(getDb()),
    storage: getStorage(),
  });
  return defaultService;
}
