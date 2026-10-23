import { importerCatalog, importerIds } from "@cohory/migration/importers";
import { Card, CardDescription, CardHeader, CardTitle } from "@cohory/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { StartImportLink } from "./start-import-link";

export const metadata: Metadata = {
  title: "Move your community",
  description: "Bring members and posts from Skool or Circle, a Cohory archive, or a spreadsheet.",
};

const otherSources = [
  {
    title: "Cohory archive",
    description:
      "The zip you export from another Cohory server, with members, posts, courses, events, points, and files.",
  },
  {
    title: "Members spreadsheet",
    description:
      "A CSV with an email column, and optionally name and role, exported from any platform.",
  },
] as const;

export default function ImportersPage() {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-text">Move your community</h1>
        <p className="text-base text-text-muted">
          Create a community, then open Manage, Migration and upload your export. You see a preview
          before anything changes.
        </p>
        <div>
          <StartImportLink />
        </div>
      </header>
      <ul className="flex flex-col gap-4">
        {importerIds.map((id) => {
          const importer = importerCatalog[id];
          return (
            <li key={id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    <Link
                      href={importer.limitsPath}
                      className="rounded-sm text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      From {importer.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {importer.transfers.slice(0, 3).join(". ")}. See what moves and what stays.
                  </CardDescription>
                </CardHeader>
              </Card>
            </li>
          );
        })}
        {otherSources.map((source) => (
          <li key={source.title}>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{source.title}</CardTitle>
                <CardDescription>{source.description}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </article>
  );
}
