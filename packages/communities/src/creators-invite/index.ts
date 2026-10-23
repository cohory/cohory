import { getDb } from "@cohory/db";

import { createPostgresManageRepository } from "../manage/postgres-repository";
import { createPostgresCreatorsInviteStore } from "./postgres-store";
import {
  createCreatorsInviteService,
  type CreatorsInviteService,
  type CreatorsInviteServiceDeps,
} from "./service";

export {
  createCreatorsInviteService,
  creatorsInviteDelayDays,
  creatorsInviteInputSchema,
  creatorsInviteLabel,
  creatorsInviteLifetimeDays,
  creatorsInviteToken,
  creatorsInviteTriggers,
  type CreatorsInviteInput,
  type CreatorsInviteMessage,
  type CreatorsInviteOutcome,
  type CreatorsInviteService,
  type CreatorsInviteServiceDeps,
  type CreatorsInviteStore,
  type CreatorsInviteTrigger,
} from "./service";
export { createPostgresCreatorsInviteStore } from "./postgres-store";

export function createDefaultCreatorsInviteService(
  deps: Omit<CreatorsInviteServiceDeps, "store">,
): CreatorsInviteService {
  const db = getDb();
  return createCreatorsInviteService({
    ...deps,
    store: createPostgresCreatorsInviteStore(db, createPostgresManageRepository(db)),
  });
}
