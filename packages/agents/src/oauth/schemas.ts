import { scopes, type Scope } from "@cohory/authz";
import { z } from "zod";

import { redirectUriProblem } from "./redirect-uri";

const redirectProblems = {
  not_absolute: "must be an absolute URL",
  fragment: "must not contain a fragment",
  credentials: "must not contain a user name or password",
  insecure: "must use https, or http on 127.0.0.1, [::1], or localhost",
  too_long: "must be 2000 characters or fewer",
} as const;

const redirectUri = z.string().superRefine((value, ctx) => {
  const problem = redirectUriProblem(value);
  if (problem) {
    ctx.addIssue({ code: "custom", message: `redirect_uris ${redirectProblems[problem]}` });
  }
});

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const registrationRequestSchema = z.object({
  redirect_uris: z.array(redirectUri).min(1).max(10),
  client_name: optionalText(100),
  client_uri: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional(),
  software_id: optionalText(200),
  software_version: optionalText(100),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(2000).optional(),
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;

export const supportedGrantTypes = ["authorization_code", "refresh_token"] as const;

const base64url43 = /^[A-Za-z0-9_-]{43}$/;

export const authorizationRequestSchema = z.object({
  response_type: z.string().optional(),
  client_id: z.string().max(200).optional(),
  redirect_uri: z.string().max(2000).optional(),
  state: z.string().max(1024).optional(),
  scope: z.string().max(2000).optional(),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  resource: z.string().max(2000).optional(),
});

export type AuthorizationRequestInput = z.infer<typeof authorizationRequestSchema>;

export function isCodeChallenge(value: string): boolean {
  return base64url43.test(value);
}

export interface ParsedScope {
  readonly known: readonly Scope[];
  readonly unknown: readonly string[];
}

export function parseScopeParam(value: string | undefined): ParsedScope | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const requested = new Set(value.trim().split(/\s+/));
  return {
    known: scopes.filter((scope) => requested.has(scope)),
    unknown: [...requested].filter((scope) => !(scopes as readonly string[]).includes(scope)),
  };
}

export const tokenRequestSchema = z.object({
  grant_type: z.string().max(100).optional(),
  client_id: z.string().max(200).optional(),
  code: z.string().max(200).optional(),
  code_verifier: z.string().max(200).optional(),
  redirect_uri: z.string().max(2000).optional(),
  refresh_token: z.string().max(200).optional(),
  scope: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});

export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export const revocationRequestSchema = z.object({
  token: z.string().max(200).optional(),
  token_type_hint: z.string().max(100).optional(),
  client_id: z.string().max(200).optional(),
});

export type RevocationRequest = z.infer<typeof revocationRequestSchema>;

export const consentChoiceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new"),
    name: z.string().trim().min(1).max(60),
  }),
  z.object({ kind: z.literal("existing"), agentId: z.uuid() }),
]);

export type ConsentAgentChoice = z.infer<typeof consentChoiceSchema>;
