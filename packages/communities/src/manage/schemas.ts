import {
  cardStyleOptions,
  faqSchema,
  hostBioMaxLength,
  hostCredentialMaxLength,
  whatYouGetSchema,
  fontOptions,
  galleryAltTextMaxLength,
  inviteLinkLabelMaxLength,
  maxGalleryItems,
  joinMode,
  joinQuestionsSchema,
  refundPolicyMaxLength,
  maxJoinQuestions,
  themeOptions,
} from "@cohory/db/schema";
import { memberAccessKinds } from "@cohory/payments";
import { z } from "zod";

import { communityPrivacySchema } from "../schemas";

export const levelNameMaxLength = 30;

export const archiveInputSchema = z.strictObject({
  paidMembers: z.enum(["stop_at_period_end", "keep_billing"]).default("stop_at_period_end"),
  includeLinked: z.boolean().default(true),
});
export const deleteCommunityInputSchema = z.strictObject({
  includeLinked: z.boolean().default(true),
  confirmedManualCancellation: z.boolean().default(false),
});
export type DeleteCommunityInput = z.input<typeof deleteCommunityInputSchema>;
export const managePageSize = 25;
export const maxManagePageSize = 100;
export const inviteMaxUsesLimit = 10_000;

export const updateSettingsInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  privacy: communityPrivacySchema.optional(),
  gamificationEnabled: z.boolean().optional(),
  pointsForLessons: z.boolean().optional(),
  pointsForEvents: z.boolean().optional(),
  reviewsEnabled: z.boolean().optional(),
  levelNames: z.array(z.string().trim().min(1).max(levelNameMaxLength)).length(9).optional(),
  joinMode: z.enum(joinMode.enumValues).optional(),
  joinQuestions: joinQuestionsSchema.optional(),
  refundPolicy: z.string().trim().min(1).max(refundPolicyMaxLength).nullable().optional(),
});

export type UpdateSettingsInput = z.input<typeof updateSettingsInputSchema>;

export const updateGeneralInputSchema = updateSettingsInputSchema.pick({
  name: true,
  description: true,
  privacy: true,
});

export type UpdateGeneralInput = z.input<typeof updateGeneralInputSchema>;

export const updateAppearanceInputSchema = z.strictObject({
  accent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Enter a color like #2563EB.")
    .nullable()
    .optional(),
  font: z.enum(fontOptions).optional(),
  cardStyle: z.enum(cardStyleOptions).optional(),
  theme: z.enum(themeOptions).optional(),
  logo: z.null().optional(),
  cover: z.null().optional(),
  detailedDescription: z.unknown().optional(),
});

export type UpdateAppearanceInput = z.input<typeof updateAppearanceInputSchema>;

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((text) => (text === "" ? null : text));
}

export const updateAboutInputSchema = z.strictObject({
  description: optionalText(2000),
  whatYouGet: whatYouGetSchema.optional(),
  hostBio: optionalText(hostBioMaxLength),
  hostCredential: optionalText(hostCredentialMaxLength),
  faq: faqSchema.optional(),
  detailedDescription: z.unknown().optional(),
});

export type UpdateAboutInput = z.input<typeof updateAboutInputSchema>;

export const galleryAltTextSchema = z
  .string()
  .trim()
  .max(galleryAltTextMaxLength, `Use ${galleryAltTextMaxLength} characters or fewer.`)
  .nullable()
  .transform((text) => (text ? text : null));

export const addGalleryVideoInputSchema = z.strictObject({
  url: z.string().trim().min(1, "Paste a video link.").max(2048),
  altText: galleryAltTextSchema.optional(),
});

export type AddGalleryVideoInput = z.input<typeof addGalleryVideoInputSchema>;

export const updateGalleryItemInputSchema = z.strictObject({ altText: galleryAltTextSchema });

export type UpdateGalleryItemInput = z.input<typeof updateGalleryItemInputSchema>;

export const reorderGalleryInputSchema = z.strictObject({
  itemIds: z.array(z.string().max(64)).max(maxGalleryItems),
});

export type ReorderGalleryInput = z.input<typeof reorderGalleryInputSchema>;

export const assignableRoles = ["admin", "moderator", "member"] as const;
export type AssignableRole = (typeof assignableRoles)[number];

export const changeRoleInputSchema = z.strictObject({ role: z.enum(assignableRoles) });

export const maxInactiveDays = 3650;

const memberFilterShape = {
  query: z.string().trim().max(80).optional(),
  role: z.enum(["owner", "admin", "moderator", "member"]).optional(),
  status: z.enum(["pending", "active", "removed", "banned"]).optional(),
  inactiveDays: z.number().int().min(1).max(maxInactiveDays).optional(),
  neverSignedIn: z.boolean().optional(),
  access: z.enum([...memberAccessKinds, "paying", "none"]).optional(),
};

export type MemberAccessFilter = NonNullable<z.output<typeof memberFilterShape.access>>;

function inactiveMeansActive<T extends { inactiveDays?: number; status?: string }>(
  input: T,
  ctx: z.RefinementCtx,
): void {
  if (input.inactiveDays !== undefined && input.status !== undefined && input.status !== "active") {
    ctx.addIssue({
      code: "custom",
      path: ["status"],
      message: "Inactive members are always active members.",
    });
  }
}

export const listManageMembersInputSchema = z
  .strictObject({
    ...memberFilterShape,
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(maxManagePageSize).optional(),
  })
  .superRefine(inactiveMeansActive);

export type ListManageMembersInput = z.input<typeof listManageMembersInputSchema>;

export const exportMembersInputSchema = z
  .strictObject(memberFilterShape)
  .superRefine(inactiveMeansActive);

export type ExportMembersInput = z.input<typeof exportMembersInputSchema>;

export const createInviteInputSchema = z.strictObject({
  expiresAt: z.date().nullable().optional(),
  maxUses: z.number().int().min(1).max(inviteMaxUsesLimit).nullable().optional(),
  requiresApproval: z.boolean().optional(),
  label: z
    .string()
    .trim()
    .max(inviteLinkLabelMaxLength, `Use ${inviteLinkLabelMaxLength} characters or fewer.`)
    .nullish()
    .transform((label) => (label ? label : null)),
});

export type CreateInviteInput = z.input<typeof createInviteInputSchema>;

export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const joinAnswerMaxLength = 1000;
export const decisionNoteMaxLength = 500;
export const joinRequestQueueLimit = 100;

export const requestToJoinInputSchema = z.strictObject({
  answers: z.array(z.string().trim().max(joinAnswerMaxLength)).max(maxJoinQuestions).default([]),
});

export type RequestToJoinInput = z.input<typeof requestToJoinInputSchema>;

export const decideJoinRequestInputSchema = z.strictObject({
  note: z
    .string()
    .trim()
    .max(decisionNoteMaxLength)
    .nullish()
    .transform((note) => (note ? note : null)),
});

export type DecideJoinRequestInput = z.input<typeof decideJoinRequestInputSchema>;

export const bulkJoinDecisionLimit = joinRequestQueueLimit;

export const decideJoinRequestsInputSchema = z.strictObject({
  requestIds: z.array(z.uuid()).min(1).max(bulkJoinDecisionLimit),
  decision: z.enum(["approve", "decline"]),
});

export type DecideJoinRequestsInput = z.input<typeof decideJoinRequestsInputSchema>;

export const bulkMemberActionLimit = maxManagePageSize;

export const bulkMemberActionInputSchema = z.strictObject({
  userIds: z.array(z.uuid()).min(1).max(bulkMemberActionLimit),
  action: z.enum(["remove", "ban"]),
});

export type BulkMemberActionInput = z.input<typeof bulkMemberActionInputSchema>;
