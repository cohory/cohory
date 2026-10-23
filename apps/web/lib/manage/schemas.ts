import {
  assignableRoles,
  bulkJoinDecisionLimit,
  bulkMemberActionLimit,
  defaultAccent,
  levelNameMaxLength,
  maxInactiveDays,
} from "@cohory/communities";
import { z } from "zod";

import { exitAnswerSchema } from "../feedback/exit-reasons";
import { accessFilters } from "./people-filters";

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, `Enter a color like ${defaultAccent}.`);

export const fontSchema = z.enum(["inter", "source-serif", "nunito-sans"]);
export const cardStyleSchema = z.enum(["soft", "minimal"]);
export const themeSchema = z.enum(["light", "dark", "system"]);

const slug = z.string().min(1).max(64);
const userId = z.uuid();

export const slugInputSchema = z.object({ slug });

export const changeSlugSchema = z.object({ slug, newSlug: z.string().max(64) });

export type ChangeSlugActionInput = z.input<typeof changeSlugSchema>;

export const previewAccentSchema = z.object({ accent: z.string().trim().max(32) });

export const saveAppearanceSchema = z.object({
  slug,
  accent: hexColorSchema.nullable(),
  font: fontSchema,
  cardStyle: cardStyleSchema,
  theme: themeSchema,
});

export type SaveAppearanceInput = z.input<typeof saveAppearanceSchema>;

export const brandingKindSchema = z.enum(["logo", "cover"]);

export const generalSettingsSchema = z.object({
  slug,
  name: z.string().trim().min(1, "Enter a community name.").max(80, "Use 80 characters or fewer."),
  privacy: z.enum(["private", "public"]),
});

export type GeneralSettingsInput = z.input<typeof generalSettingsSchema>;

export const levelNamesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Give every level a name.")
      .max(levelNameMaxLength, `Keep level names to ${levelNameMaxLength} characters or fewer.`),
  )
  .length(9, "Name all nine levels.");

export const gamificationSchema = z.object({
  slug,
  enabled: z.boolean(),
  levelNames: levelNamesSchema,
  pointsForLessons: z.boolean().optional(),
  pointsForEvents: z.boolean().optional(),
});

export type GamificationInput = z.input<typeof gamificationSchema>;

export const listPeopleSchema = z.object({
  slug,
  query: z.string().trim().max(80).optional(),
  role: z.enum(["owner", "admin", "moderator", "member"]).optional(),
  status: z.enum(["pending", "active", "removed", "banned"]).optional(),
  inactiveDays: z.number().int().min(1).max(maxInactiveDays).optional(),
  neverSignedIn: z.boolean().optional(),
  access: z.enum(accessFilters).optional(),
  cursor: z.string().max(512).optional(),
});

export type ListPeopleInput = z.input<typeof listPeopleSchema>;

export const personActionSchema = z.object({
  slug,
  userId,
  action: z.enum(["remove", "ban", "unban"]),
});

export type PersonActionInput = z.input<typeof personActionSchema>;

export const memberActionSchema = z.object({ slug, userId });

const selectedUserIds = z.array(userId).min(1).max(bulkMemberActionLimit);

export const bulkPersonActionSchema = z.object({
  slug,
  userIds: selectedUserIds,
  action: z.enum(["remove", "ban"]),
});

export type BulkPersonActionInput = z.input<typeof bulkPersonActionSchema>;

export const bulkBillingSchema = z.object({ slug, userIds: selectedUserIds });

export const decideJoinRequestsSchema = z.object({
  slug,
  requestIds: z.array(z.uuid()).min(1).max(bulkJoinDecisionLimit),
  decision: z.enum(["approve", "decline"]),
});

export type DecideJoinRequestsActionInput = z.input<typeof decideJoinRequestsSchema>;

export const changeRoleSchema = z.object({ slug, userId, role: z.enum(assignableRoles) });

export type ChangeRoleInput = z.input<typeof changeRoleSchema>;

export const createInviteSchema = z.object({
  slug,
  expiresInDays: z.number().int().min(1).max(365).nullable(),
  maxUses: z.number().int().min(1).max(10_000).nullable(),
  requiresApproval: z.boolean().default(false),
  label: z.string().trim().max(60, "Keep the label to 60 characters or fewer.").default(""),
});

export type CreateInviteActionInput = z.input<typeof createInviteSchema>;

export const revokeInviteSchema = z.object({ slug, inviteId: z.uuid() });

export const transferSchema = z.object({ slug, userId, confirmName: z.string() });

export type TransferInput = z.input<typeof transferSchema>;

export const archiveSchema = z.object({
  slug,
  archived: z.boolean(),
  paidMembers: z.enum(["stop_at_period_end", "keep_billing"]).optional(),
  includeLinked: z.boolean().optional(),
  exit: exitAnswerSchema,
});

export type ArchiveActionInput = z.input<typeof archiveSchema>;

export const confirmNameSchema = z.object({ slug, confirmName: z.string() });

export type ConfirmNameInput = z.input<typeof confirmNameSchema>;

export const deleteCommunitySchema = confirmNameSchema.extend({
  includeLinked: z.boolean().default(true),
  confirmedManualCancellation: z.boolean().default(false),
  exit: exitAnswerSchema,
});

export type DeleteCommunityActionInput = z.input<typeof deleteCommunitySchema>;

export const retryDeleteSchema = z.object({ slug, includeLinked: z.boolean().default(true) });

export type RetryDeleteActionInput = z.input<typeof retryDeleteSchema>;

export function namesMatch(expected: string, typed: string): boolean {
  return expected.trim() === typed.trim();
}

export const joinModeSchema = z.enum(["open", "approval", "invite"]);

export const joinQuestionInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Write the question or remove it.")
    .max(200, "Keep questions to 200 characters or fewer."),
  required: z.boolean(),
});

export const accessSettingsSchema = z.object({
  slug,
  joinMode: joinModeSchema,
  joinQuestions: z.array(joinQuestionInputSchema).max(3, "Ask up to three questions."),
});

export type AccessSettingsInput = z.input<typeof accessSettingsSchema>;

export const decideJoinRequestSchema = z.object({
  slug,
  requestId: z.uuid(),
  decision: z.enum(["approve", "decline"]),
  note: z.string().trim().max(500, "Keep the note to 500 characters or fewer.").default(""),
});

export type DecideJoinRequestActionInput = z.input<typeof decideJoinRequestSchema>;
