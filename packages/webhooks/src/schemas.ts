import { isIP } from "node:net";

import { CommunityValidationError } from "@cohory/communities";
import { webhookEventTypes } from "@cohory/events";
import { z } from "zod";

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CommunityValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export const maxEndpointsPerCommunity = 20;
export const deliveriesPageSize = 25;
export const maxDeliveriesPageSize = 100;

const localNames = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

export function endpointUrlSchema(allowPrivateHosts: readonly string[]) {
  const allowed = new Set(allowPrivateHosts.map((host) => host.toLowerCase()));
  return z
    .string()
    .trim()
    .min(8)
    .max(2048)
    .superRefine((value, ctx) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Enter a full URL, starting with https://." });
        return;
      }
      const host = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
      if (allowed.has(host)) {
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          ctx.addIssue({ code: "custom", message: "Use an http or https URL." });
        }
        return;
      }
      if (url.protocol !== "https:") {
        ctx.addIssue({ code: "custom", message: "Use an https URL." });
      }
      if (url.username || url.password) {
        ctx.addIssue({
          code: "custom",
          message: "Remove the user name and password from the URL.",
        });
      }
      if (isIP(host) !== 0 || localNames.test(host) || !host.includes(".")) {
        ctx.addIssue({
          code: "custom",
          message: "Use a public host name. Private and local addresses are not allowed.",
        });
      }
    });
}

const eventTypesSchema = z
  .array(z.enum(webhookEventTypes))
  .min(1, "Choose at least one event.")
  .transform((types) => [...new Set(types)].sort());

const descriptionSchema = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((value) => (value ? value : null));

export function createEndpointInputSchema(allowPrivateHosts: readonly string[]) {
  return z.strictObject({
    url: endpointUrlSchema(allowPrivateHosts),
    description: descriptionSchema,
    eventTypes: eventTypesSchema,
  });
}

export function updateEndpointInputSchema(allowPrivateHosts: readonly string[]) {
  return z
    .strictObject({
      url: endpointUrlSchema(allowPrivateHosts).optional(),
      description: descriptionSchema.optional(),
      eventTypes: eventTypesSchema.optional(),
    })
    .refine((input) => Object.values(input).some((value) => value !== undefined), {
      message: "Change the URL, the description, or the events.",
    });
}

export const listDeliveriesInputSchema = z.strictObject({
  cursor: z.string().max(512).optional(),
  limit: z.int().min(1).max(maxDeliveriesPageSize).optional(),
});

export const secretOverlapMs = 24 * 60 * 60 * 1000;
export const maxResendBatch = 500;
export const attemptsShown = 50;

export const rotateSecretInputSchema = z.strictObject({
  keepPrevious: z.boolean().optional(),
});

export const resendFailedInputSchema = z.strictObject({
  since: z.union([
    z.date(),
    z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  ]),
});

export type CreateEndpointInput = z.input<ReturnType<typeof createEndpointInputSchema>>;
export type RotateSecretInput = z.input<typeof rotateSecretInputSchema>;
export type ResendFailedInput = z.input<typeof resendFailedInputSchema>;
export type UpdateEndpointInput = z.input<ReturnType<typeof updateEndpointInputSchema>>;
export type ListDeliveriesInput = z.input<typeof listDeliveriesInputSchema>;
