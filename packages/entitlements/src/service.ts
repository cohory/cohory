import { createAgentAccessOperations, type AgentAccessOperations } from "./service/agent-access";
import { createRuntime, type EntitlementsServiceDeps } from "./service/context";
import { createDelegationOperations, type DelegationOperations } from "./service/delegations";
import { createSubmissionOperations, type SubmissionOperations } from "./service/submissions";
import { createSweepOperations, type SweepOperations } from "./service/sweep";

export type EntitlementsService = AgentAccessOperations &
  DelegationOperations &
  SubmissionOperations &
  SweepOperations;

export function createEntitlementsService(deps: EntitlementsServiceDeps): EntitlementsService {
  const runtime = createRuntime(deps);
  const access = createAgentAccessOperations(runtime);
  return {
    ...access,
    ...createDelegationOperations(runtime),
    ...createSubmissionOperations(runtime, access),
    ...createSweepOperations(runtime),
  };
}
