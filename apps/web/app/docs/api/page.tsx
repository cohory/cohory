import { createOpenApiDocument } from "@cohory/api";
import { getPlatformConfig } from "@cohory/config/platform";
import type { Metadata } from "next";
import Link from "next/link";

import { buildReference } from "../../../lib/docs/api-reference";
import { Operation } from "./operation";
import { Quickstart } from "./quickstart";

export const metadata: Metadata = { title: "API reference" };

const link = "font-medium text-accent underline-offset-4 hover:underline";

export default function ApiReferencePage() {
  const { appUrl, instance } = getPlatformConfig();
  const reference = buildReference(JSON.parse(JSON.stringify(createOpenApiDocument())));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">API reference</h1>
        <p className="text-sm text-text-muted">
          Scripts and AI assistants use this API to read and change communities on {instance.name}.
          This page is built from the{" "}
          <Link href="/api/openapi.json" className={link}>
            OpenAPI document
          </Link>
          , so it always matches this server. Use the document to generate a client or import it
          into your API tool.
        </p>
      </div>

      <Quickstart appUrl={reference.serverUrl ?? appUrl} />

      <section aria-labelledby="operations" className="flex flex-col gap-4">
        <h2 id="operations" className="text-xl font-semibold text-text">
          Operations
        </h2>
        <nav aria-label="API sections">
          <ul className="flex flex-wrap gap-2">
            {reference.tags.map((tag) => (
              <li key={tag.anchor}>
                <a
                  href={`#${tag.anchor}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-text hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {tag.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {reference.tags.map((tag) => (
          <section
            key={tag.anchor}
            id={tag.anchor}
            aria-labelledby={`${tag.anchor}-heading`}
            className="flex scroll-mt-20 flex-col gap-2"
          >
            <h3 id={`${tag.anchor}-heading`} className="text-lg font-semibold text-text">
              {tag.name}
            </h3>
            {tag.operations.map((operation) => (
              <Operation key={operation.id} operation={operation} />
            ))}
          </section>
        ))}
      </section>
    </div>
  );
}
