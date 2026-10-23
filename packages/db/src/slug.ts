import { z } from "zod";

export const communitySlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits, and single hyphens only")
  .brand<"CommunitySlug">();

export type CommunitySlug = z.infer<typeof communitySlugSchema>;
