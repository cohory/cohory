import { z } from "zod";

export const createCommunityFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give your community a name. It can be changed later.")
    .max(80, "Use 80 characters or fewer for the name."),
  slug: z
    .string()
    .trim()
    .min(3, "Use at least 3 characters for the URL.")
    .max(48, "Use 48 characters or fewer for the URL.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and single hyphens, like makers-guild.",
    ),
  description: z
    .string()
    .trim()
    .max(2000, "Use 2,000 characters or fewer for the description.")
    .transform((value) => (value === "" ? null : value)),
  privacy: z.enum(["private", "public"], { error: "Choose who can see the community." }),
  pricing: z.enum(["free", "paid"], { error: "Choose free or paid." }),
});

export const communitySlugField = createCommunityFormSchema.shape.slug;

export type CreateCommunityField = keyof z.input<typeof createCommunityFormSchema>;

export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export const creationClosedMessage = "Only the people who run this server can create communities.";
