import { communitySlugSchema } from "@cohory/db";
import { z } from "zod";

export const reservedSlugs: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "auth",
  "communities",
  "community",
  "dashboard",
  "docs",
  "help",
  "login",
  "logout",
  "manage",
  "mcp",
  "new",
  "settings",
  "sign-in",
  "sign-out",
  "sign-up",
  "signin",
  "signup",
  "static",
  "support",
  "www",
]);

export const communityPrivacySchema = z.enum(["private", "public"]);

export const createCommunityInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: communitySlugSchema,
  description: z.string().trim().max(2000).nullish(),
  privacy: communityPrivacySchema.default("private"),
});

export type CreateCommunityInput = z.input<typeof createCommunityInputSchema>;
