import type { AgentsService } from "@cohory/agents";
import { vi, type Mock } from "vitest";

export type AgentsStub = { [K in keyof AgentsService]: Mock<AgentsService[K]> };

export function createAgentsStub(): AgentsStub {
  return {
    authenticate: vi.fn<AgentsService["authenticate"]>(),
    listPersonalTokens: vi.fn<AgentsService["listPersonalTokens"]>(),
    createPersonalToken: vi.fn<AgentsService["createPersonalToken"]>(),
    revokePersonalToken: vi.fn<AgentsService["revokePersonalToken"]>(),
    regeneratePersonalToken: vi.fn<AgentsService["regeneratePersonalToken"]>(),
    listAgents: vi.fn<AgentsService["listAgents"]>(),
    listOwnAgents: vi.fn<AgentsService["listOwnAgents"]>(),
    findAgent: vi.fn<AgentsService["findAgent"]>(),
    agentSummaries: vi.fn<AgentsService["agentSummaries"]>(),
    createAgent: vi.fn<AgentsService["createAgent"]>(),
    createAgentWithToken: vi.fn<AgentsService["createAgentWithToken"]>(),
    updateAgent: vi.fn<AgentsService["updateAgent"]>(),
    revokeAgent: vi.fn<AgentsService["revokeAgent"]>(),
    issueAgentToken: vi.fn<AgentsService["issueAgentToken"]>(),
    regenerateAgentToken: vi.fn<AgentsService["regenerateAgentToken"]>(),
    revokeAgentToken: vi.fn<AgentsService["revokeAgentToken"]>(),
    agentNames: vi.fn<AgentsService["agentNames"]>(),
    revokeAllCredentials: vi.fn<AgentsService["revokeAllCredentials"]>(),
    recordApiWrite: vi.fn<AgentsService["recordApiWrite"]>(),
  };
}
