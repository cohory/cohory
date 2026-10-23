import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";

import { CopyButton } from "../manage/copy-button";

const codeClass =
  "block rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs break-all text-text";

export function ConnectAssistant({
  mcpUrl,
  communityName,
  canConnect,
  titleAs = "h3",
}: {
  mcpUrl: string;
  communityName: string;
  canConnect: boolean;
  titleAs?: "h3" | "h4";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as={titleAs} className="text-lg">
          Connect an AI assistant
        </CardTitle>
        <CardDescription>
          Assistants that support MCP, such as Claude, ChatGPT, and Codex, can work in{" "}
          {communityName} through this address.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <code data-testid="mcp-url" className={codeClass}>
          {mcpUrl}
        </code>
        <div className="self-start">
          <CopyButton value={mcpUrl} label="Copy address" copiedMessage="Address copied." />
        </div>
        {canConnect ? (
          <>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-text">
              <li>
                Claude: open Settings, Connectors, Add custom connector, and paste the address.
              </li>
              <li>
                ChatGPT: turn on developer mode in Settings, Connectors, then create a connector
                with the address.
              </li>
              <li>
                Codex: add the address under <code className="font-mono text-xs">mcp_servers</code>{" "}
                in <code className="font-mono text-xs">~/.codex/config.toml</code>, then run{" "}
                <code className="font-mono text-xs">codex mcp login</code>.
              </li>
            </ol>
            <p className="text-text-muted">
              The assistant opens a sign in page here. You pick the community, the agent, and what
              it may do. Or use a token: create an agent below, issue a token, and give the
              assistant the address and the token.
            </p>
          </>
        ) : (
          <p className="text-text-muted">
            Only owners and admins can connect apps. Members can create an agent by hand: create an
            agent below, issue a token, and give the assistant the address and the token.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
