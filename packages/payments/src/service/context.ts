import {
  UnauthenticatedError,
  type Actor,
  type CommunityRole,
  type PolicyContext,
} from "@cohory/authz";
import { communityIdSchema, newId, type CommunityId } from "@cohory/db";
import { noCommunityAccess } from "@cohory/entitlements/access";
import type { z } from "zod";
import { logger } from "@cohory/infra/logger";

import type { PaymentsEnv } from "../config";
import { decryptSecret, type Keyring } from "../crypto";
import {
  EmailNotConfirmedError,
  PaymentsNotFoundError,
  PaymentsUnavailableError,
  PaymentsValidationError,
  ProviderDisabledError,
  ProviderRejectedError,
  StripeRejectedError,
} from "../errors";
import { effectiveFeeBps } from "../fee";
import type { StripeGateway, WebhookVerifier } from "../gateway";
import type { PaymentsJobs } from "../jobs";
import { isProviderEnabled as providerEnabled } from "../providers/capabilities";
import { createProviderRegistry, type ProviderRegistry } from "../providers/registry";
import { createStripeProvider } from "../providers/stripe/adapter";
import type { Connection, ConnectionSetup, PaymentProvider } from "../providers/types";
import type {
  CommunityRecord,
  ConnectionRecord,
  MemberRecord,
  PaymentsRepository,
  PaymentsStore,
} from "../repository";

export type BillingSuspensionCheck = (communityId: CommunityId) => Promise<boolean>;

export interface PaymentsServiceDeps {
  readonly repo: PaymentsRepository;
  readonly env: PaymentsEnv;
  readonly platformGateway?: StripeGateway | null;
  readonly gatewayForSecret?: (secretKey: string) => StripeGateway;
  readonly verifyWebhook?: WebhookVerifier;
  readonly jobs?: PaymentsJobs | null;
  readonly providers?: readonly PaymentProvider[];
  readonly fetch?: typeof fetch;
  readonly isBillingSuspended?: BillingSuspensionCheck;
  readonly requireConfirmedEmail?: boolean;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly log?: (entry: Readonly<Record<string, string | number | boolean | null>>) => void;
}

export interface Runtime {
  readonly repo: PaymentsRepository;
  readonly env: PaymentsEnv;
  readonly jobs: PaymentsJobs | null;
  readonly providers: ProviderRegistry;
  readonly fetch: typeof fetch;
  readonly isBillingSuspended: BillingSuspensionCheck;
  readonly requireConfirmedEmail: boolean;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly log: (entry: Readonly<Record<string, string | number | boolean | null>>) => void;
}

function providerRegistry(deps: PaymentsServiceDeps): ProviderRegistry {
  const stripeDeps = {
    platformGateway: deps.platformGateway ?? null,
    gatewayForSecret: deps.gatewayForSecret ?? null,
    verifyWebhook: deps.verifyWebhook ?? null,
    webhookSecrets: deps.env.webhookSecrets,
    platformSecretKey: deps.env.stripeSecretKey,
    connectClientId: deps.env.connectClientId,
  };
  const byId = new Map<string, PaymentProvider>();
  for (const provider of [
    createStripeProvider("stripe_connect", stripeDeps),
    createStripeProvider("stripe_own_keys", stripeDeps),
    ...(deps.providers ?? []),
  ]) {
    byId.set(provider.id, provider);
  }
  return createProviderRegistry([...byId.values()]);
}

export function createRuntime(deps: PaymentsServiceDeps): Runtime {
  return {
    repo: deps.repo,
    env: deps.env,
    jobs: deps.jobs ?? null,
    providers: providerRegistry(deps),
    fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
    isBillingSuspended: deps.isBillingSuspended ?? (() => Promise.resolve(false)),
    requireConfirmedEmail: deps.requireConfirmedEmail ?? false,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId ?? newId,
    log: deps.log ?? ((entry) => logger.info(entry)),
  };
}

export interface Access {
  readonly store: PaymentsStore;
  readonly community: CommunityRecord;
  readonly member: MemberRecord | null;
  readonly role: CommunityRole | null;
  readonly viewerId: string | null;
  readonly context: PolicyContext;
}

// Whoever connects a payment account is the person Stripe and members will contact, so the
// address must be proven when this server can send email.
export async function assertEmailConfirmed(
  runtime: Runtime,
  store: Pick<PaymentsStore, "isUserEmailConfirmed">,
  userId: string,
): Promise<void> {
  if (runtime.requireConfirmedEmail && !(await store.isUserEmailConfirmed(userId))) {
    throw new EmailNotConfirmedError();
  }
}

export function requireUserId(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new UnauthenticatedError();
  }
  return actor.userId;
}

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PaymentsValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export async function loadCommunity(
  runtime: Runtime,
  communityId: string,
): Promise<CommunityRecord> {
  const parsed = communityIdSchema.safeParse(communityId);
  const community = parsed.success ? await runtime.repo.findCommunity(parsed.data) : null;
  if (!community) {
    throw new PaymentsNotFoundError("community");
  }
  return community;
}

export async function withAccess<T>(
  runtime: Runtime,
  actor: Actor,
  communityId: string,
  fn: (access: Access) => Promise<T>,
): Promise<T> {
  const community = await loadCommunity(runtime, communityId);
  const viewerId = actor.kind === "user" ? actor.userId : null;
  return runtime.repo.inCommunity(community.id, viewerId, async (store) => {
    const member = viewerId ? await store.findMember(viewerId) : null;
    const { role, entitled } = viewerId
      ? await store.findAccess(viewerId, runtime.now())
      : noCommunityAccess;
    return fn({
      store,
      community,
      member,
      role,
      viewerId,
      context: { role, communityPrivacy: community.privacy, entitled },
    });
  });
}

export function requireAppUrl(runtime: Runtime): string {
  if (!runtime.env.appUrl) {
    throw new PaymentsUnavailableError("APP_URL");
  }
  return runtime.env.appUrl;
}

export function requireEncryptionKey(runtime: Runtime): Keyring {
  if (!runtime.env.encryptionKeys) {
    throw new PaymentsUnavailableError("PAYMENTS_ENCRYPTION_KEY");
  }
  return runtime.env.encryptionKeys;
}

export interface BoundProvider {
  readonly provider: PaymentProvider;
  readonly conn: Connection;
}

function decrypted(runtime: Runtime, sealed: string | null, connectionId: string): string | null {
  return sealed ? decryptSecret(sealed, requireEncryptionKey(runtime), connectionId) : null;
}

export function connectionFor(runtime: Runtime, connection: ConnectionRecord): Connection {
  return {
    id: connection.id,
    communityId: connection.communityId,
    provider: connection.provider,
    externalAccountId: connection.externalAccountId,
    livemode: connection.livemode,
    apiCredential: decrypted(runtime, connection.encryptedSecret, connection.id),
    webhookSecret: decrypted(runtime, connection.webhookSecretEncrypted, connection.id),
  };
}

export function providerFor(runtime: Runtime, connection: ConnectionRecord): BoundProvider {
  return {
    provider: runtime.providers.get(connection.provider),
    conn: connectionFor(runtime, connection),
  };
}

export function providerWithSetup(runtime: Runtime, setup: ConnectionSetup): PaymentProvider {
  for (const id of runtime.providers.ids()) {
    const provider = runtime.providers.get(id);
    if (provider.setup === setup) {
      return provider;
    }
  }
  throw new PaymentsUnavailableError(`${setup} provider`);
}

export function connectsWithAccessToken(runtime: Runtime, connection: ConnectionRecord): boolean {
  return runtime.providers.find(connection.provider)?.setup === "access_token";
}

export function isProviderEnabled(
  env: PaymentsEnv,
  provider: ConnectionRecord["provider"],
): boolean {
  return providerEnabled(provider, env);
}

export function assertProviderEnabled(
  runtime: Runtime,
  provider: ConnectionRecord["provider"],
): void {
  if (!isProviderEnabled(runtime.env, provider)) {
    throw new ProviderDisabledError(provider);
  }
}

export function splitsFees(runtime: Runtime, connection: ConnectionRecord): boolean {
  return runtime.providers.find(connection.provider)?.capabilities(null).supportsFeeSplit ?? false;
}

export function feeBpsFor(runtime: Runtime, connection: ConnectionRecord): number {
  return effectiveFeeBps({
    edition: runtime.env.edition,
    provider: connection.provider,
    configuredBps: runtime.env.platformFeeBps,
  });
}

export function timeBucket(now: Date, minutes: number): number {
  return Math.floor(now.getTime() / (minutes * 60_000));
}

function stripeErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "type" in error && "code" in error) {
    const { type, code } = error;
    if (typeof type === "string" && type.startsWith("Stripe")) {
      return typeof code === "string" ? code : type;
    }
  }
  return null;
}

function stripeRequestId(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "requestId" in error) {
    const { requestId } = error;
    return typeof requestId === "string" ? requestId : null;
  }
  return null;
}

export async function callStripe<T>(runtime: Runtime, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (error instanceof ProviderRejectedError) {
      runtime.log({
        msg: "payment provider rejected a request",
        level: "warn",
        provider: error.providerName,
        status: error.status,
        code: error.providerCode,
      });
      throw error;
    }
    const code = stripeErrorCode(error);
    if (code !== null || (error instanceof Error && error.name.startsWith("Stripe"))) {
      runtime.log({
        msg: "stripe rejected a request",
        level: "warn",
        code,
        requestId: stripeRequestId(error),
        detail: error instanceof Error ? error.message.slice(0, 200) : null,
      });
      throw new StripeRejectedError(code);
    }
    throw error;
  }
}
