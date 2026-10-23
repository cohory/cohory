import {
  importerCatalog,
  importerIds,
  importerSafetyNote,
  isImporterId,
} from "@cohory/migration/importers";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StartImportLink } from "../start-import-link";

export function generateStaticParams() {
  return importerIds.map((source) => ({ source }));
}

export async function generateMetadata({
  params,
}: PageProps<"/importers/[source]">): Promise<Metadata> {
  const { source } = await params;
  return {
    title: isImporterId(source) ? `Importing from ${importerCatalog[source].name}` : "Importer",
  };
}

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default async function ImporterLimitsPage({ params }: PageProps<"/importers/[source]">) {
  const { source } = await params;
  if (!isImporterId(source)) notFound();
  const importer = importerCatalog[source];

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-text">Importing from {importer.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <Badge variant="neutral">Importer {importer.version}</Badge>
          <span>Best effort. Checked against public documentation on {importer.checkedOn}.</span>
        </div>
        <p className="text-base text-text-muted">
          {importer.name} decides what its exports contain and can change them. This page says what
          the importer reads and what stays behind, so nothing surprises you. You see a preview
          before anything changes, and the import works on a new, empty community.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <StartImportLink />
          <Link
            href="/importers"
            className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Other ways to move
          </Link>
        </div>
      </header>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Files to bring
          </CardTitle>
          <CardDescription>
            Upload them together in Manage, Migration of your new community.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3 text-sm">
            {importer.files.map((file) => (
              <li key={file.label}>
                <span className="font-medium text-text">{file.label}.</span>{" "}
                <span className="text-text-muted">{file.description}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            What moves
          </CardTitle>
        </CardHeader>
        <CardContent>
          <List items={importer.transfers} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            What does not move
          </CardTitle>
          <CardDescription>No importer can move payment methods.</CardDescription>
        </CardHeader>
        <CardContent>
          <List items={importer.doesNotTransfer} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Safety and limits
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-text">
          <p>
            {importerSafetyNote} Formatting is kept; scripts, styles, forms, and unsafe links are
            removed before anything is saved.
          </p>
          <p className="text-text-muted">Sources read:</p>
          <ul className="flex flex-col gap-1">
            {importer.sources.map((entry) => (
              <li key={entry.url}>
                <a
                  className="break-all text-accent underline-offset-4 hover:underline"
                  href={entry.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </article>
  );
}
