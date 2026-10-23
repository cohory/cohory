interface Named {
  readonly id: string;
  readonly name: string;
}

export function activitySubject(
  chosen: { readonly agentId?: string; readonly tokenId?: string },
  agents: readonly (Named & { readonly tokens: readonly Named[] })[],
  personalTokens: readonly Named[],
): string {
  if (chosen.agentId) {
    return (
      agents.find((agent) => agent.id === chosen.agentId)?.name ?? "An agent you no longer have"
    );
  }
  if (chosen.tokenId) {
    const tokens = [...agents.flatMap((agent) => agent.tokens), ...personalTokens];
    return (
      tokens.find((token) => token.id === chosen.tokenId)?.name ?? "A token you no longer have"
    );
  }
  return "Your agents and tokens";
}
