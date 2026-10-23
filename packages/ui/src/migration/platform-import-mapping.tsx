"use client";

import { useId, type ReactNode } from "react";

import { Select } from "../primitives/select";
import type { PlatformAmbiguousAuthor, PlatformImportMapping } from "./types";

const roleLabels = { admin: "Admin", moderator: "Moderator" } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </div>
  );
}

export function ImportMapping({ mapping }: { mapping: PlatformImportMapping }) {
  const moreRoles = mapping.rolesTotal - mapping.roles.length;
  return (
    <>
      <Section title="Roles">
        {mapping.roles.length === 0 ? (
          <p className="text-sm text-text-muted">Everyone joins as a member.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-text">
            {mapping.roles.map((entry) => (
              <li key={entry.email} className="break-words">
                {entry.name} becomes {roleLabels[entry.role]}
                {entry.sourceRole &&
                entry.sourceRole.toLowerCase() !== entry.role &&
                entry.sourceRole.toLowerCase() !== roleLabels[entry.role].toLowerCase() ? (
                  <span className="text-text-muted"> ({entry.sourceRole} in the file)</span>
                ) : null}
              </li>
            ))}
            {moreRoles > 0 ? <li className="text-text-muted">and {moreRoles} more</li> : null}
          </ul>
        )}
      </Section>
      {mapping.categories.length > 0 ? (
        <Section title="Categories">
          <ul className="flex flex-col gap-1 text-sm text-text">
            {mapping.categories.map((entry) => (
              <li key={entry.source} className="break-words">
                {entry.source}:{" "}
                <span className="text-text-muted">
                  {entry.target === null
                    ? "no category, the limit is reached"
                    : entry.existing
                      ? `merged into ${entry.target}`
                      : "new category"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {mapping.sample ? (
        <Section title="Sample post">
          <figure className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
            {mapping.sample.title ? (
              <p className="font-medium text-text">{mapping.sample.title}</p>
            ) : null}
            <figcaption className="text-xs text-text-muted">
              By {mapping.sample.author}
              {mapping.sample.category ? ` in ${mapping.sample.category}` : ""}
            </figcaption>
            <p className="text-text">{mapping.sample.excerpt}</p>
          </figure>
        </Section>
      ) : null}
    </>
  );
}

export function AuthorChoices({
  authors,
  choices,
  onChoose,
}: {
  authors: readonly PlatformAmbiguousAuthor[];
  choices: Readonly<Record<string, string>>;
  onChoose(placeholderId: string, memberId: string): void;
}) {
  const id = useId();
  if (authors.length === 0) return null;
  return (
    <Section title="Members with the same name">
      <p className="text-sm text-text-muted">
        Choose who wrote the posts and comments under each name. If you leave a name as is, they
        show under that name, marked as former member.
      </p>
      <ul className="flex flex-col gap-3">
        {authors.map((author, index) => (
          <li key={author.placeholderId} className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-${index}`} className="font-medium text-text">
              {author.name}
            </label>
            <Select
              id={`${id}-${index}`}
              value={choices[author.placeholderId] ?? ""}
              onChange={(event) => onChoose(author.placeholderId, event.currentTarget.value)}
            >
              <option value="">Keep as {author.name} (former member)</option>
              {author.candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.email})
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Section>
  );
}
