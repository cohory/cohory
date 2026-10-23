import { BotIcon } from "lucide-react";

import { Badge } from "../primitives/badge";

export function AgentBadge({ name }: { name: string }) {
  return (
    <Badge variant="neutral" data-slot="agent-badge" title={`Written by the agent ${name}`}>
      <BotIcon className="size-3" aria-hidden="true" strokeWidth={1.5} />
      Agent
      <span className="sr-only">: {name}</span>
    </Badge>
  );
}
