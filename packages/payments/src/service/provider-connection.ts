import { assertCan, type Actor } from "@cohory/authz";
import { z } from "zod";

import { encryptSecret } from "../crypto";
import {
  AlreadyConnectedError,
  NotConnectedError,
  PaymentAccountReviewRequiredError,
  PaymentsValidationError,
} from "../errors";
import type { AccountState } from "../gateway";
import type { Connection } from "../providers/types";
import type { ConnectionRecord } from "../repository";
import {
  connectProviderInputSchema,
  providerWebhookSecretInputSchema,
  type ConnectProviderInput,
  type ProviderWebhookSecretInput,
} from "../schemas";
import { awaitsOwnerReview, toConnectionView, type ConnectionView } from "../views";
import {
  assertEmailConfirmed,
  assertProviderEnabled,
  callStripe,
  connectionFor,
  connectsWithAccessToken,
  parse,
  requireAppUrl,
  requireEncryptionKey,
  requireUserId,
  withAccess,
  type Runtime,
} from "./context";

export interface TestWebhookResult {
  readonly delivered: boolean;
  readonly status: number | null;
  readonly outcome: string | null;
  readonly connection: ConnectionView;
}

export interface ProviderConnectionOperations {
  connectProvider(
    actor: Actor,
    communityId: string,
    input: ConnectProviderInput,
  ): Promise<ConnectionView>;
  saveProviderWebhookSecret(
    actor: Actor,
    communityId: string,
    input: ProviderWebhookSecretInput,
  ): Promise<ConnectionView>;
  sendTestWebhook(actor: Actor, communityId: string): Promise<TestWebhookResult>;
}

export function byoStatus(
  state: AccountState,
  webhookSecretSaved: boolean,
): ConnectionRecord["status"] {
  if (!webhookSecretSaved) {
    return "onboarding";
  }
  return state.chargesEnabled ? "active" : state.detailsSubmitted ? "restricted" : "onboarding";
}

const outcomeSchema = z.object({ outcome: z.string() });

function requireByoConnection(
  runtime: Runtime,
  connection: ConnectionRecord | null,
): ConnectionRecord {
  if (!connection || !connectsWithAccessToken(runtime, connection)) {
    throw new NotConnectedError();
  }
  return connection;
}

export function createProviderConnectionOperations(runtime: Runtime): ProviderConnectionOperations {
  const { env } = runtime;

  return {
    async connectProvider(actor, communityId, input) {
      const userId = requireUserId(actor);
      const key = requireEncryptionKey(runtime);
      const parsed = parse(connectProviderInputSchema, input);
      assertProviderEnabled(runtime, parsed.provider);
      if (parsed.server === "production" && env.nodeEnv !== "production") {
        throw new PaymentsValidationError([
          { path: "server", message: "Use the sandbox until this server runs in production" },
        ]);
      }
      const provider = runtime.providers.get(parsed.provider);
      const community = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "connect", "payment", context);
          await assertEmailConfirmed(runtime, store, userId);
          return community;
        },
      );
      const id = runtime.newId();
      const probe: Connection = {
        id,
        communityId: community.id,
        provider: parsed.provider,
        externalAccountId: null,
        livemode: parsed.server === "production",
        apiCredential: parsed.accessToken,
        webhookSecret: null,
      };
      const state = await callStripe(runtime, () => provider.getAccountState(probe));
      return runtime.repo.inCommunity(community.id, userId, async (store) => {
        await store.enableManagement();
        const existing = await store.findOpenConnection();
        if (existing && existing.provider !== parsed.provider) {
          throw new AlreadyConnectedError();
        }
        if (existing && awaitsOwnerReview(existing, userId)) {
          throw new PaymentAccountReviewRequiredError();
        }
        if (existing) {
          await store.updateConnection(existing.id, {
            status: "disconnected",
            disconnectedAt: runtime.now(),
          });
        }
        const connection = await store.insertConnection({
          id,
          provider: parsed.provider,
          acceptedOwnerId: userId,
          externalAccountId: state.id,
          encryptedSecret: encryptSecret(parsed.accessToken, key, id),
          status: byoStatus(state, false),
          chargesEnabled: state.chargesEnabled,
          detailsSubmitted: state.detailsSubmitted,
          livemode: parsed.server === "production",
        });
        return toConnectionView(connection);
      });
    },

    async saveProviderWebhookSecret(actor, communityId, input) {
      const userId = requireUserId(actor);
      const key = requireEncryptionKey(runtime);
      const { webhookSecret } = parse(providerWebhookSecretInputSchema, input);
      const { community, connection } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "connect", "payment", context);
          return {
            community,
            connection: requireByoConnection(runtime, await store.findOpenConnection()),
          };
        },
      );
      return runtime.repo.inCommunity(community.id, userId, async (store) => {
        await store.enableManagement();
        const updated = await store.updateConnection(connection.id, {
          webhookSecretEncrypted: encryptSecret(webhookSecret, key, connection.id),
          status: byoStatus(
            {
              id: connection.externalAccountId ?? connection.id,
              chargesEnabled: connection.chargesEnabled,
              detailsSubmitted: connection.detailsSubmitted,
              livemode: connection.livemode,
              country: null,
            },
            true,
          ),
        });
        return toConnectionView(updated);
      });
    },

    async sendTestWebhook(actor, communityId) {
      const appUrl = requireAppUrl(runtime);
      const { community, connection } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "connect", "payment", context);
          return {
            community,
            connection: requireByoConnection(runtime, await store.findOpenConnection()),
          };
        },
      );
      const provider = runtime.providers.get(connection.provider);
      const view = toConnectionView(connection);
      if (!connection.webhookSecretEncrypted || !provider.signTestEvent || !view.webhookPath) {
        throw new PaymentsValidationError([
          { path: "webhookSecret", message: "Save the webhook secret first" },
        ]);
      }
      const signed = provider.signTestEvent(
        connectionFor(runtime, connection),
        `cohory_test_${runtime.newId()}`,
        runtime.now(),
      );
      let status: number | null = null;
      let outcome: string | null = null;
      try {
        const response = await runtime.fetch(`${appUrl}${view.webhookPath}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...signed.headers },
          body: signed.rawBody,
          signal: AbortSignal.timeout(10_000),
        });
        status = response.status;
        const body = outcomeSchema.safeParse(await response.json().catch(() => null));
        outcome = body.success ? body.data.outcome : null;
      } catch (error: unknown) {
        runtime.log({
          msg: "test webhook could not reach the app",
          level: "warn",
          connectionId: connection.id,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
      const current = await runtime.repo.inCommunityAsSystem(community.id, async (store) =>
        store.findOpenConnection(),
      );
      return {
        delivered: status === 200,
        status,
        outcome,
        connection: toConnectionView(current ?? connection),
      };
    },
  };
}
