"use client";

import { Field, Select } from "@cohory/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { eventLabel } from "../../lib/webhooks/views";

const verifySnippet = `import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(secret, headers, rawBody) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"] ?? "";
  if (!id || !timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false;
  }
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(
    \`v1,\${createHmac("sha256", key).update(\`\${id}.\${timestamp}.\${rawBody}\`).digest("base64")}\`,
  );
  return signatures.split(" ").some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}`;

const codeClass =
  "overflow-x-auto rounded-md border border-border bg-surface-raised p-3 font-mono text-xs leading-relaxed text-text";

export function ReceiverGuide({ samples }: { samples: Readonly<Record<string, string>> }) {
  const types = Object.keys(samples);
  const [type, setType] = useState(types[0] ?? "");

  return (
    <details className="group rounded-md border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm font-medium text-text outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          strokeWidth={1.5}
        />
        How to verify requests
      </summary>
      <div className="flex min-w-0 flex-col gap-3 px-3 pb-4 text-sm text-text-muted">
        <p>
          Every request is a <code className="font-mono text-xs">POST</code> with a JSON body and
          three{" "}
          <a
            href="https://www.standardwebhooks.com/"
            className="font-medium text-accent underline-offset-4 hover:underline"
            rel="noreferrer"
            target="_blank"
          >
            Standard Webhooks
          </a>{" "}
          headers: <code className="font-mono text-xs">webhook-id</code>,{" "}
          <code className="font-mono text-xs">webhook-timestamp</code>, and{" "}
          <code className="font-mono text-xs">webhook-signature</code>. Check the signature against
          the raw body before you parse it, and use{" "}
          <code className="font-mono text-xs">webhook-id</code> to drop duplicates.
        </p>
        <p>
          While an old secret still works after a rotation, the signature header holds two
          signatures separated by a space. Accept the request when any of them matches.
        </p>
        <pre tabIndex={0} className={codeClass}>
          <code>{verifySnippet}</code>
        </pre>
        <Field label="Sample payload">
          {(control) => (
            <Select {...control} value={type} onChange={(event) => setType(event.target.value)}>
              {types.map((name) => (
                <option key={name} value={name}>
                  {eventLabel(name)} ({name})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <pre tabIndex={0} className={codeClass}>
          <code>{samples[type]}</code>
        </pre>
        <p>
          Payloads carry ids only. Fetch details with the{" "}
          <Link
            href="/docs/api"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            API
          </Link>{" "}
          and your own token.
        </p>
      </div>
    </details>
  );
}
