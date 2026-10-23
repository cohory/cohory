import { z } from "@hono/zod-openapi";
import {
  assignableRoles,
  levelNameMaxLength,
  maxInactiveDays,
  maxManagePageSize,
  type AppearanceView,
  type InviteLinkView,
  type ManageMember,
  type ManageSettingsView,
  type RedeemedInvite,
} from "@cohory/communities";
import { memberAccessKinds } from "@cohory/payments";

import { cursorQuery } from "../pagination";

import { contentDocumentSchema, slugParams } from "./posts-schemas";

const isoDate = z.iso.datetime().openapi({ description: "ISO 8601 UTC timestamp." });
const hex = z.string().openapi({ example: "#2563EB" });
const role = z.enum(["owner", "admin", "moderator", "member"]);
const status = z.enum(["pending", "active", "removed", "banned"]);
const fonts = z.enum(["inter", "source-serif", "nunito-sans"]);
const cardStyles = z.enum(["minimal", "soft"]);
const themes = z.enum(["light", "dark", "system"]);
const joinModes = z.enum(["open", "approval", "invite"]);
const joinQuestionSchema = z.object({
  text: z.string().max(200),
  required: z.boolean(),
});

export const overviewSchema = z
  .object({
    memberCount: z.int().nonnegative(),
    newMembers7d: z.int().nonnegative(),
    posts7d: z.int().nonnegative(),
    comments7d: z.int().nonnegative(),
    upcomingEvents: z.int().nonnegative(),
    publishedCourses: z.int().nonnegative(),
  })
  .openapi("ManageOverview");

const usageItemSchema = z.object({
  used: z.int().nonnegative(),
  limit: z.int().positive().nullable().openapi({ description: "null means no limit." }),
  state: z.enum(["ok", "near", "reached"]),
});

export const usageSchema = z
  .object({
    tier: z.enum(["free", "paid"]),
    members: usageItemSchema,
    storageBytes: usageItemSchema,
    uploadBytes: z.int().positive().nullable(),
  })
  .openapi("ManageUsage");

export const settingsSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    privacy: z.enum(["private", "public"]),
    gamificationEnabled: z.boolean(),
    pointsForLessons: z
      .boolean()
      .openapi({ description: "Whether members earn 1 point for each lesson they finish." }),
    pointsForEvents: z
      .boolean()
      .openapi({ description: "Whether members earn 1 point for each event they attend." }),
    reviewsEnabled: z.boolean().openapi({ description: "Whether members can leave reviews." }),
    levelNames: z.array(z.string()).length(9),
    joinMode: joinModes,
    joinQuestions: z.array(joinQuestionSchema).max(3),
    archivedAt: isoDate.nullable(),
  })
  .openapi("CommunitySettings");

export const updateSettingsBodySchema = z
  .object({
    name: z.string().max(80).optional(),
    description: z.string().max(2000).nullable().optional(),
    privacy: z.enum(["private", "public"]).optional(),
    gamificationEnabled: z.boolean().optional(),
    pointsForLessons: z.boolean().optional().openapi({
      description:
        "Give 1 point for each lesson a member finishes, while points and levels are on. Off by default.",
    }),
    pointsForEvents: z.boolean().optional().openapi({
      description:
        "Give 1 point for each event a member attends (a going RSVP, once it ends), while points and levels are on. Off by default.",
    }),
    reviewsEnabled: z.boolean().optional().openapi({
      description:
        "Turn reviews on or off. Off hides every review on the About page but keeps them.",
    }),
    levelNames: z
      .array(z.string().max(levelNameMaxLength * 4))
      .length(9)
      .optional()
      .openapi({ description: `Nine names, 1 to ${levelNameMaxLength} characters each.` }),
    joinMode: joinModes.optional(),
    joinQuestions: z
      .array(joinQuestionSchema)
      .max(3)
      .optional()
      .openapi({ description: "Up to three questions shown with Request to join." }),
  })
  .openapi("UpdateCommunitySettings");

const modeTokensSchema = z.object({
  accent: hex,
  accentHover: hex,
  accentForeground: hex,
  accentMuted: hex,
  ring: hex,
});

const ratiosSchema = z.object({
  accentOnBackground: z.number(),
  foregroundOnAccent: z.number(),
  accentOnMuted: z.number(),
});

export const appearanceSchema = z
  .object({
    accent: hex.nullable().openapi({ description: "Null means the default accent." }),
    logoUrl: z.string().nullable(),
    coverUrl: z.string().nullable(),
    font: fonts,
    cardStyle: cardStyles,
    theme: themes,
    tokens: z.object({
      light: modeTokensSchema,
      dark: modeTokensSchema,
      ratios: z.object({ light: ratiosSchema, dark: ratiosSchema }),
      font: fonts,
      cardStyle: cardStyles,
      theme: themes,
      fallbackUsed: z.boolean(),
      warning: z.enum(["red_hue"]).nullable(),
    }),
    cssVariables: z.object({
      light: z.record(z.string(), z.string()),
      dark: z.record(z.string(), z.string()),
    }),
    notices: z.array(z.object({ code: z.enum(["fallback", "red_hue"]), message: z.string() })),
    detailedDescription: contentDocumentSchema.nullable(),
  })
  .openapi("CommunityAppearance");

export const updateAppearanceBodySchema = z
  .object({
    accent: z.string().max(32).nullable().optional().openapi({
      description:
        "A #RRGGBB color. The server derives readable tokens for light and dark mode. Anything else, or a color that cannot be made readable, uses the default accent and returns a notice. Null resets to the default.",
    }),
    font: fonts.optional(),
    cardStyle: cardStyles.optional(),
    theme: themes.optional(),
    logo: z.null().optional().openapi({ description: "Null removes the logo." }),
    cover: z.null().optional().openapi({ description: "Null removes the cover image." }),
    detailedDescription: contentDocumentSchema.nullable().optional(),
  })
  .openapi("UpdateCommunityAppearance");

export const manageMemberSchema = z
  .object({
    userId: z.uuid(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    email: z
      .string()
      .nullable()
      .openapi({ description: "Null unless the caller is an admin or owner." }),
    role,
    status,
    joinedAt: isoDate.nullable(),
    lastActiveAt: isoDate.openapi({
      description:
        "Latest activity in this community (posts, comments, likes, lesson views, RSVPs; joined_at when there is none) or the latest sign in to the platform, whichever is later.",
    }),
    level: z.int(),
    points: z.int(),
  })
  .openapi("ManageMember");

export const memberChangeSchema = z
  .object({ userId: z.uuid(), role, status })
  .openapi("MemberChange");

const memberFilterQuery = {
  query: z
    .string()
    .max(80)
    .optional()
    .openapi({
      param: { name: "query", in: "query" },
      description: "Name, username, or (admins) email prefix.",
    }),
  role: role.optional().openapi({ param: { name: "role", in: "query" } }),
  status: status.optional().openapi({
    param: { name: "status", in: "query" },
    description: "Defaults to active in the list and to every status in the export.",
  }),
  inactiveDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(maxInactiveDays)
    .optional()
    .openapi({
      param: { name: "inactiveDays", in: "query" },
      example: 30,
      description:
        "Only active members whose last activity (see lastActiveAt) is more than this many days ago.",
    }),
  neverSignedIn: z
    .stringbool()
    .optional()
    .openapi({
      type: "boolean",
      param: { name: "neverSignedIn", in: "query" },
      description: "Only people who have never signed in, such as imported members.",
    }),
  access: z
    .enum([...memberAccessKinds, "paying", "none"])
    .optional()
    .openapi({
      param: { name: "access", in: "query" },
      description:
        "Only people with this access. paying means any paid subscription (monthly, yearly, past due, or cancelling). Needs permission to read payments.",
    }),
};

export const exportMembersQuerySchema = z.object(memberFilterQuery);

export const peopleQuerySchema = z.object({
  ...memberFilterQuery,
  ...cursorQuery({ max: maxManagePageSize, example: 25 }),
});

export const personParams = slugParams.extend({
  userId: z.uuid().openapi({ param: { name: "userId", in: "path" } }),
});

export const inviteParams = slugParams.extend({
  inviteId: z.string().openapi({ param: { name: "inviteId", in: "path" } }),
});

export const tokenParams = z.object({
  token: z
    .string()
    .max(128)
    .openapi({ param: { name: "token", in: "path" } }),
});

export const changeRoleBodySchema = z
  .object({ role: z.enum(assignableRoles) })
  .openapi("ChangeMemberRole");

export const archiveBodySchema = z
  .object({
    paidMembers: z.enum(["stop_at_period_end", "keep_billing"]).optional().openapi({
      description:
        "What happens to paying members. stop_at_period_end (default) sets every subscription to end at its period end; keep_billing leaves them running.",
    }),
    includeLinked: z.boolean().optional().openapi({
      description:
        "Whether subscriptions linked from before Cohory follow the choice. Defaults to true.",
    }),
  })
  .openapi("ArchiveCommunity");

export const deleteBodySchema = z
  .object({
    includeLinked: z.boolean().optional().openapi({
      description:
        "Whether subscriptions linked from before Cohory are cancelled too. Defaults to true. When false they keep running in the creator's Stripe account without the Cohory fee.",
    }),
    confirmedManualCancellation: z.boolean().optional().openapi({
      description:
        "The owner confirms they cancelled the remaining subscriptions in their Stripe Dashboard. Needed when Stripe is disconnected and Cohory still counts paying members. Defaults to false.",
    }),
  })
  .openapi("DeleteCommunity");

export const deletingSchema = z
  .object({ status: z.literal("deleting") })
  .openapi("CommunityDeleting");

export const transferBodySchema = z
  .object({ userId: z.uuid().openapi({ description: "An active member who becomes the owner." }) })
  .openapi("TransferOwnership");

export const inviteSchema = z
  .object({
    id: z.uuid(),
    token: z.string(),
    path: z
      .string()
      .openapi({ example: "/join/abc", description: "Share this path on the instance URL." }),
    createdBy: z.uuid(),
    expiresAt: isoDate.nullable(),
    maxUses: z.int().nullable(),
    useCount: z.int().nonnegative(),
    requiresApproval: z.boolean(),
    revokedAt: isoDate.nullable(),
    createdAt: isoDate,
    status: z.enum(["active", "expired", "used_up", "revoked"]),
  })
  .openapi("InviteLink");

export const createInviteBodySchema = z
  .object({
    expiresAt: isoDate.nullable().optional(),
    maxUses: z.int().min(1).max(10_000).nullable().optional(),
    requiresApproval: z
      .boolean()
      .optional()
      .openapi({ description: "When true, redeeming creates a join request instead." }),
  })
  .openapi("CreateInviteLink");

export const redeemedInviteSchema = z
  .object({
    community: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
    membership: z
      .object({
        id: z.uuid(),
        communityId: z.uuid(),
        userId: z.uuid(),
        role,
        status,
        joinedAt: isoDate.nullable(),
      })
      .nullable(),
    request: z
      .object({
        id: z.uuid(),
        status: z.enum(["pending", "approved", "declined"]),
        createdAt: isoDate,
      })
      .nullable()
      .openapi({ description: "Set when the invite link requires approval." }),
  })
  .openapi("RedeemedInvite");

export const brandingUploadFormSchema = z.object({
  file: z
    .custom<File>((value) => value instanceof File, { message: "Attach an image file." })
    .openapi({ type: "string", format: "binary" }),
});

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function settingsJson(view: ManageSettingsView): z.infer<typeof settingsSchema> {
  return {
    ...view,
    levelNames: [...view.levelNames],
    joinQuestions: view.joinQuestions.map((question) => ({ ...question })),
    archivedAt: iso(view.archivedAt),
  };
}

export function appearanceJson(view: AppearanceView): z.infer<typeof appearanceSchema> {
  return {
    ...view,
    detailedDescription: view.detailedDescription
      ? { type: "doc", content: [...view.detailedDescription.content] }
      : null,
    cssVariables: { light: { ...view.cssVariables.light }, dark: { ...view.cssVariables.dark } },
    notices: [...view.notices],
  };
}

export function manageMemberJson(member: ManageMember): z.infer<typeof manageMemberSchema> {
  return {
    ...member,
    joinedAt: iso(member.joinedAt),
    lastActiveAt: member.lastActiveAt.toISOString(),
  };
}

export function inviteJson(invite: InviteLinkView): z.infer<typeof inviteSchema> {
  return {
    ...invite,
    expiresAt: iso(invite.expiresAt),
    revokedAt: iso(invite.revokedAt),
    createdAt: invite.createdAt.toISOString(),
  };
}

export function redeemedJson(result: RedeemedInvite): z.infer<typeof redeemedInviteSchema> {
  return {
    community: result.community,
    membership: result.membership
      ? { ...result.membership, joinedAt: iso(result.membership.joinedAt) }
      : null,
    request: result.request
      ? {
          id: result.request.id,
          status: result.request.status,
          createdAt: result.request.createdAt.toISOString(),
        }
      : null,
  };
}
