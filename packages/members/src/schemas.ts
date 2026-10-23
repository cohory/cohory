import { maxLevel } from "@cohory/gamification";
import { stripInvisible } from "@cohory/posts";
import { z } from "zod";

export const membersPageSize = 20;
export const maxMembersPageSize = 100;
export const maxBioLength = 500;
export const recentActivityLimit = 10;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(30, "Use at most 30 characters.")
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/,
    "Use lowercase letters, digits, and single hyphens, starting and ending with a letter or digit.",
  );

export const reservedUsernames: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "administrator",
  "all",
  "api",
  "app",
  "auth",
  "cohory",
  "communities",
  "everyone",
  "help",
  "here",
  "login",
  "logout",
  "me",
  "member",
  "members",
  "mod",
  "moderator",
  "new",
  "null",
  "owner",
  "root",
  "settings",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "staff",
  "support",
  "system",
  "undefined",
  "www",
]);

export const setUsernameInputSchema = z.strictObject({ username: usernameSchema });

export type SetUsernameInput = z.input<typeof setUsernameInputSchema>;

export const updateProfileInputSchema = z.strictObject({
  bio: z
    .string()
    .trim()
    .max(maxBioLength, `Keep the bio under ${maxBioLength} characters.`)
    .nullable()
    .transform((bio) => (bio ? stripInvisible(bio) || null : null)),
});

export type UpdateProfileInput = z.input<typeof updateProfileInputSchema>;

export const searchMembersInputSchema = z.strictObject({
  query: z.string().trim().max(80).optional(),
  level: z.int().min(1).max(maxLevel).optional(),
  cursor: z.string().max(512).nullish(),
  limit: z.int().min(1).max(maxMembersPageSize).optional(),
});

export type SearchMembersInput = z.input<typeof searchMembersInputSchema>;
