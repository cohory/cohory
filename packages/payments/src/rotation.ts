import {
  decryptSecret,
  encryptSecret,
  needsReencryption,
  SecretDecryptionError,
  type Keyring,
} from "./crypto";
import type { PaymentsRepository, SealedConnection } from "./repository";

export interface SecretRotationResult {
  readonly scanned: number;
  readonly reencrypted: number;
  readonly unreadable: readonly string[];
}

const batchSize = 100;

function rotate(sealed: string | null, keys: Keyring, context: string): string | null {
  if (sealed === null || !needsReencryption(sealed, keys)) {
    return sealed;
  }
  return encryptSecret(decryptSecret(sealed, keys, context), keys, context);
}

function isCurrent(connection: SealedConnection, keys: Keyring): boolean {
  return [connection.encryptedSecret, connection.webhookSecretEncrypted].every(
    (sealed) => sealed === null || !needsReencryption(sealed, keys),
  );
}

export async function reencryptConnectionSecrets(
  repo: Pick<PaymentsRepository, "listSealedConnections" | "replaceSealedSecrets">,
  keys: Keyring,
): Promise<SecretRotationResult> {
  let scanned = 0;
  let reencrypted = 0;
  const unreadable: string[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await repo.listSealedConnections(afterId, batchSize);
    for (const connection of page) {
      scanned += 1;
      if (isCurrent(connection, keys)) {
        continue;
      }
      try {
        const next = {
          encryptedSecret: rotate(connection.encryptedSecret, keys, connection.id),
          webhookSecretEncrypted: rotate(connection.webhookSecretEncrypted, keys, connection.id),
        };
        if (await repo.replaceSealedSecrets(connection, next)) {
          reencrypted += 1;
        }
      } catch (error: unknown) {
        if (!(error instanceof SecretDecryptionError)) {
          throw error;
        }
        unreadable.push(connection.id);
      }
    }
    const last = page.at(-1);
    if (!last || page.length < batchSize) {
      return { scanned, reencrypted, unreadable };
    }
    afterId = last.id;
  }
}

export interface DefaultRotationDeps {
  readonly repo: Pick<PaymentsRepository, "listSealedConnections" | "replaceSealedSecrets">;
  readonly keys: Keyring | null;
}

export async function rotatePaymentSecrets(
  deps: DefaultRotationDeps,
): Promise<SecretRotationResult | null> {
  return deps.keys ? reencryptConnectionSecrets(deps.repo, deps.keys) : null;
}
