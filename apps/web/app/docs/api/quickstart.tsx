import Link from "next/link";
import type { ReactNode } from "react";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-surface-hover p-3 text-sm text-text">
      <code>{children}</code>
    </pre>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2">
      <h3 className="font-medium text-text">{title}</h3>
      {children}
    </li>
  );
}

const text = "text-sm text-text-muted";
const inline = "font-mono text-xs text-text";
const link = "font-medium text-accent underline-offset-4 hover:underline";

export function Quickstart({ appUrl }: { appUrl: string }) {
  const base = `${appUrl}/api/v1`;
  return (
    <section aria-labelledby="quickstart" className="flex flex-col gap-4">
      <h2 id="quickstart" className="text-xl font-semibold text-text">
        Quickstart
      </h2>
      <ol className="flex flex-col gap-6">
        <Step title="1. Create a token">
          <p className={text}>
            Create a personal token on the{" "}
            <Link href="/account/api-tokens" className={link}>
              API tokens
            </Link>{" "}
            page, or an agent token in Manage, Settings, Agents. A token works in one community and
            only for the permissions you give it. Keep it secret.
          </p>
        </Step>
        <Step title="2. Find the base URL and your community">
          <p className={text}>
            Every request goes to <code className={inline}>{base}</code>. Most paths start with{" "}
            <code className={inline}>/communities/{"{slug}"}</code>. The slug is the part after{" "}
            <code className={inline}>/c/</code> in the community address.
          </p>
        </Step>
        <Step title="3. Make a request">
          <p className={text}>Send the token as a bearer token. This lists the newest posts:</p>
          <Code>{`curl ${base}/communities/your-community/posts \\
  -H "Authorization: Bearer $COHORY_TOKEN"`}</Code>
          <p className={text}>
            Lists answer <code className={inline}>{"{ data, nextCursor }"}</code>. Pass{" "}
            <code className={inline}>nextCursor</code> as <code className={inline}>cursor</code> to
            get the next page; it is null on the last page. Errors answer{" "}
            <code className={inline}>{"{ error: { code, message, details } }"}</code> with a stable
            code.
          </p>
        </Step>
        <Step title="4. Connect an AI assistant">
          <p className={text}>
            Assistants use the MCP server at <code className={inline}>{`${appUrl}/mcp`}</code> with
            an agent token. Owners and admins can also sign in with OAuth from the assistant. For
            Claude Code:
          </p>
          <Code>{`claude mcp add --transport http cohory ${appUrl}/mcp \\
  --header "Authorization: Bearer $COHORY_TOKEN"`}</Code>
        </Step>
      </ol>
    </section>
  );
}
