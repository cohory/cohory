import { scopeListSchema } from "@cohory/authz";
import { z } from "zod";

import { AgentsValidationError } from "./errors";

export const defaultTokenDays = 90;
export const maxTokenDays = 365;

const name = z
  .string()
  .trim()
  .min(1, { error: "Give it a name." })
  .max(60, { error: "Use 60 characters or fewer." });

const expiresInDays = z
  .number()
  .int()
  .min(1, { error: "Choose at least 1 day." })
  .max(maxTokenDays, { error: `Choose ${maxTokenDays} days or fewer.` })
  .default(defaultTokenDays);

export const createPersonalTokenInputSchema = z.strictObject({
  communityId: z.uuid({ error: "Choose a community." }),
  name,
  scopes: scopeListSchema,
  expiresInDays,
});

export const createAgentInputSchema = z.strictObject({
  name,
  description: z
    .string()
    .trim()
    .max(280, { error: "Use 280 characters or fewer." })
    .optional()
    .transform((value) => (value ? value : null)),
  scopes: scopeListSchema,
  communityWide: z.boolean().default(false),
});

export const updateAgentInputSchema = z
  .strictObject({
    name: name.optional(),
    description: z
      .string()
      .trim()
      .max(280, { error: "Use 280 characters or fewer." })
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? undefined : value || null)),
    scopes: scopeListSchema.optional(),
    communityWide: z.boolean().optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: "Change at least one thing.",
  });

export const issueAgentTokenInputSchema = z.strictObject({
  name,
  expiresInDays,
});

export type CreatePersonalTokenInput = z.input<typeof createPersonalTokenInputSchema>;
export type CreateAgentInput = z.input<typeof createAgentInputSchema>;
export type UpdateAgentInput = z.input<typeof updateAgentInputSchema>;
export type IssueAgentTokenInput = z.input<typeof issueAgentTokenInputSchema>;

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AgentsValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}
