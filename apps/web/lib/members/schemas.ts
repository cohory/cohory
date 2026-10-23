import { maxLevel } from "@cohory/gamification";
import { maxBioLength, usernameSchema } from "@cohory/members";
import { z } from "zod";

import { maxQueryLength } from "./params";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const searchMembersActionSchema = z.object({
  slug,
  query: z.string().trim().max(maxQueryLength),
  level: z.int().min(1).max(maxLevel).nullable(),
  cursor: z.string().min(1).max(512),
});

export const updateBioActionSchema = z.object({
  slug,
  bio: z.string().trim().max(maxBioLength, `Keep the bio under ${maxBioLength} characters.`),
});

export const usernameFormSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Enter a username.")
    .transform((value) => value.replace(/^@/, ""))
    .pipe(usernameSchema),
});

export type SearchMembersActionInput = z.input<typeof searchMembersActionSchema>;
export type UpdateBioActionInput = z.input<typeof updateBioActionSchema>;
