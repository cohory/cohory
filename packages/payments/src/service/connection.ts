import { assertCan, type Actor } from "@cohory/authz";

import { assertTestModeKey, type PaymentsEnv } from "../config";
import { encryptSecret } from "../crypto";
import {
  AlreadyConnectedError,
  CreatorTermsRequiredError,
  EditionMismatchError,
  NotConnectedError,
  PaymentAccountReviewRequiredError,
  PaymentsUnavailableError,
  PaymentsValidationError,
} from "../errors";
import type { AccountState } from "../gateway";
import type { Connection, ConnectionSetup, HostedOnboarding } from "../providers/types";
import type { ConnectionPatch, ConnectionRecord } from "../repository";
import {
  connectStripeInputSchema,
  ownKeysInputSchema,
  type ConnectStripeInput,
  type OwnKeysInput,
} from "../schemas";
import {
  awaitsOwnerReview,
  toConnectionView,
  type ConnectionView,
  type PaymentsOverview,
  type RedirectView,
} from "../views";
import { byoStatus } from "./provider-connection";
import {
  assertEmailConfirmed,
  callStripe,
  connectsWithAccessToken,
  isProviderEnabled,
  parse,
  providerFor,
  providerWithSetup,
  requireAppUrl,
  requireEncryptionKey,
  requireUserId,
  withAccess,
  type Runtime,
} from "./context";

export interface ConnectionOperations {
  getPaymentsOverview(actor: Actor, communityId: string): Promise<PaymentsOverview>;
  connectStripe(
    actor: Actor,
    communityId: string,
    input?: ConnectStripeInput,
  ): Promise<RedirectView & { connection: ConnectionView }>;
  connectOwnKeys(actor: Actor, communityId: string, input: OwnKeysInput): Promise<ConnectionView>;
  refreshConnection(actor: Actor, communityId: string): Promise<ConnectionView>;
  acceptCreatorTerms(actor: Actor, communityId: string): Promise<void>;
  creatorTermsAccepted(actor: Actor, communityId: string): Promise<boolean>;
}

export type AccountStatePatch = Required<
  Pick<ConnectionPatch, "chargesEnabled" | "detailsSubmitted" | "livemode" | "status">
>;

export function statePatch(state: AccountState): AccountStatePatch {
  return {
    chargesEnabled: state.chargesEnabled,
    detailsSubmitted: state.detailsSubmitted,
    livemode: state.livemode,
    status: state.chargesEnabled ? "active" : state.detailsSubmitted ? "restricted" : "onboarding",
  };
}

export async function fetchAccountState(
  runtime: Runtime,
  connection: ConnectionRecord,
): Promise<AccountState> {
  const { provider, conn } = providerFor(runtime, connection);
  return callStripe(runtime, () => provider.getAccountState(conn));
}

const offeredOn: Readonly<Record<ConnectionSetup, readonly PaymentsEnv["edition"][]>> = {
  platform_account: ["cloud"],
  own_keys: ["community"],
  access_token: ["cloud", "community"],
};

function requireHostedOnboarding(runtime: Runtime): {
  readonly providerId: ConnectionRecord["provider"];
  readonly onboarding: HostedOnboarding;
} {
  const provider = providerWithSetup(runtime, "platform_account");
  if (!provider.hostedOnboarding) {
    throw new PaymentsUnavailableError(`${provider.displayName} onboarding`);
  }
  return { providerId: provider.id, onboarding: provider.hostedOnboarding() };
}

export function createConnectionOperations(runtime: Runtime): ConnectionOperations {
  const { env } = runtime;
  const providers = runtime.providers
    .ids()
    .filter(
      (id) =>
        offeredOn[runtime.providers.get(id).setup].includes(env.edition) &&
        isProviderEnabled(env, id),
    );
  let platformCountry: Promise<string | null> | undefined;

  function resolveCountry(onboarding: HostedOnboarding, requested: string | null): Promise<string> {
    if (requested) {
      return Promise.resolve(requested);
    }
    platformCountry ??= callStripe(runtime, () => onboarding.platformCountry());
    platformCountry.catch(() => {
      platformCountry = undefined;
    });
    return platformCountry.then((country) => {
      if (!country) {
        throw new PaymentsValidationError([
          { path: "country", message: "Choose the country of your business" },
        ]);
      }
      return country;
    });
  }

  return {
    async getPaymentsOverview(actor, communityId) {
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        const connection = await store.findOpenConnection();
        return {
          edition: env.edition,
          platformFeeBps: env.edition === "cloud" ? env.platformFeeBps : 0,
          providers,
          connection: connection ? toConnectionView(connection) : null,
          polarRetired: connection !== null && !isProviderEnabled(env, connection.provider),
        };
      });
    },

    async connectStripe(actor, communityId, input = {}) {
      if (env.edition !== "cloud") {
        throw new EditionMismatchError("cloud");
      }
      const { providerId, onboarding } = requireHostedOnboarding(runtime);
      const appUrl = requireAppUrl(runtime);
      const {
        email,
        country: requestedCountry,
        acceptCreatorTerms,
      } = parse(connectStripeInputSchema, input);
      const userId = requireUserId(actor);
      const prepared = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "connect", "payment", context);
          await assertEmailConfirmed(runtime, store, userId);
          await store.enableManagement();
          if (acceptCreatorTerms) {
            await store.acceptCreatorTerms(userId, env.creatorTermsVersion);
          } else if (!(await store.hasAcceptedCreatorTerms(userId, env.creatorTermsVersion))) {
            throw new CreatorTermsRequiredError();
          }
          const existing = await store.findOpenConnection();
          if (existing && existing.provider !== providerId) {
            throw new AlreadyConnectedError();
          }
          if (existing && awaitsOwnerReview(existing, userId)) {
            throw new PaymentAccountReviewRequiredError();
          }
          const connection =
            existing ??
            (await store.insertConnection({
              id: runtime.newId(),
              provider: providerId,
              status: "onboarding",
              acceptedOwnerId: userId,
            }));
          return { connection, community };
        },
      );
      let { connection } = prepared;
      const { community } = prepared;
      if (!connection.externalAccountId) {
        const country = await resolveCountry(onboarding, requestedCountry);
        const created = await callStripe(runtime, () =>
          onboarding.createAccount(
            {
              displayName: community.name,
              email,
              country,
              metadata: { cohory_community_id: community.id, cohory_connection_id: connection.id },
            },
            `connect:${connection.id}:account`,
          ),
        );
        connection = await runtime.repo.inCommunityAsSystem(community.id, (store) =>
          store.updateConnection(connection.id, {
            externalAccountId: created.id,
            ...statePatch(created),
          }),
        );
      }
      const accountId = connection.externalAccountId;
      if (!accountId) {
        throw new NotConnectedError();
      }
      const base = `${appUrl}/c/${community.slug}/manage/payments`;
      const linkInput = {
        accountId,
        refreshUrl: `${base}?stripe=refresh`,
        returnUrl: `${base}?stripe=return`,
      };
      const link = await callStripe(runtime, () =>
        onboarding.createLink(linkInput, `connect:${connection.id}:link:${runtime.newId()}`),
      );
      return { url: link.url, connection: toConnectionView(connection) };
    },

    async acceptCreatorTerms(actor, communityId) {
      if (env.edition !== "cloud") {
        throw new EditionMismatchError("cloud");
      }
      const userId = requireUserId(actor);
      await withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "connect", "payment", context);
        await store.enableManagement();
        await store.acceptCreatorTerms(userId, env.creatorTermsVersion);
      });
    },

    async creatorTermsAccepted(actor, communityId) {
      if (env.edition !== "cloud") {
        return true;
      }
      const userId = requireUserId(actor);
      return withAccess(runtime, actor, communityId, async ({ store, context }) => {
        assertCan(actor, "read", "payment", context);
        await store.enableManagement();
        return store.hasAcceptedCreatorTerms(userId, env.creatorTermsVersion);
      });
    },

    async connectOwnKeys(actor, communityId, input) {
      const userId = requireUserId(actor);
      if (env.edition !== "community") {
        throw new EditionMismatchError("community");
      }
      const key = requireEncryptionKey(runtime);
      const { secretKey, webhookSecret } = parse(ownKeysInputSchema, input);
      assertTestModeKey(secretKey, env.nodeEnv);
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
      const provider = providerWithSetup(runtime, "own_keys");
      const id = runtime.newId();
      const probe: Connection = {
        id,
        communityId: community.id,
        provider: provider.id,
        externalAccountId: null,
        livemode: false,
        apiCredential: secretKey,
        webhookSecret: null,
      };
      const state = await callStripe(runtime, () => provider.getAccountState(probe));
      return runtime.repo.inCommunity(community.id, userId, async (store) => {
        await store.enableManagement();
        const existing = await store.findOpenConnection();
        if (existing && existing.provider !== provider.id) {
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
          provider: provider.id,
          acceptedOwnerId: userId,
          externalAccountId: state.id,
          encryptedSecret: encryptSecret(secretKey, key, id),
          webhookSecretEncrypted: encryptSecret(webhookSecret, key, id),
          ...statePatch(state),
          livemode: secretKey.includes("_live_"),
        });
        return toConnectionView(connection);
      });
    },

    async refreshConnection(actor, communityId) {
      const { community, connection } = await withAccess(
        runtime,
        actor,
        communityId,
        async ({ store, community, context }) => {
          assertCan(actor, "read", "payment", context);
          const connection = await store.findOpenConnection();
          if (!connection?.externalAccountId) {
            throw new NotConnectedError();
          }
          return { community, connection };
        },
      );
      const state = await fetchAccountState(runtime, connection);
      const byo = connectsWithAccessToken(runtime, connection);
      const accountMode = runtime.providers.get(connection.provider).setup === "platform_account";
      const updated = await runtime.repo.inCommunityAsSystem(community.id, (store) =>
        store.updateConnection(connection.id, {
          ...statePatch(state),
          ...(byo ? { status: byoStatus(state, connection.webhookSecretEncrypted !== null) } : {}),
          livemode: accountMode ? state.livemode : connection.livemode,
        }),
      );
      return toConnectionView(updated);
    },
  };
}
