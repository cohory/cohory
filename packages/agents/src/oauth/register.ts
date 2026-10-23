import { newId as defaultNewId } from "@cohory/db";
import { oauthClients } from "@cohory/db/schema";

import type { OAuthServiceDeps } from "./context";
import { OAuthError } from "./errors";
import { registrationRequestSchema, supportedGrantTypes } from "./schemas";

export interface RegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly response_types: readonly string[];
  readonly token_endpoint_auth_method: "none";
  readonly client_uri?: string;
  readonly software_id?: string;
  readonly software_version?: string;
}

export const unnamedClient = "Unnamed app";

export function createRegistration(deps: OAuthServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? defaultNewId;

  return async function register(raw: unknown): Promise<RegistrationResponse> {
    const parsed = registrationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const redirect = issue?.path[0] === "redirect_uris";
      throw new OAuthError(
        redirect ? "invalid_redirect_uri" : "invalid_client_metadata",
        issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid client metadata",
      );
    }
    const input = parsed.data;
    const grantTypes = input.grant_types ?? [...supportedGrantTypes];
    if (
      !grantTypes.includes("authorization_code") ||
      grantTypes.some((type) => !(supportedGrantTypes as readonly string[]).includes(type))
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        "grant_types may only contain authorization_code and refresh_token",
      );
    }
    if (input.response_types && input.response_types.some((type) => type !== "code")) {
      throw new OAuthError("invalid_client_metadata", "response_types may only contain code");
    }
    const at = now();
    const [row] = await deps.db
      .insert(oauthClients)
      .values({
        id: newId(),
        clientName: input.client_name ?? unnamedClient,
        redirectUris: [...new Set(input.redirect_uris)],
        clientUri: input.client_uri ?? null,
        softwareId: input.software_id ?? null,
        softwareVersion: input.software_version ?? null,
        createdAt: at,
      })
      .returning();
    if (!row) {
      throw new Error("oauth client insert returned no row");
    }
    return {
      client_id: row.id,
      client_id_issued_at: Math.floor(at.getTime() / 1000),
      client_name: row.clientName,
      redirect_uris: row.redirectUris,
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(row.clientUri ? { client_uri: row.clientUri } : {}),
      ...(row.softwareId ? { software_id: row.softwareId } : {}),
      ...(row.softwareVersion ? { software_version: row.softwareVersion } : {}),
    };
  };
}
