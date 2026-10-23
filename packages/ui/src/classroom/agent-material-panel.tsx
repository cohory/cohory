"use client";

import { BotIcon, DownloadIcon, SendIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "../primitives/alert";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../primitives/dialog";
import { Field } from "../primitives/field";
import { Textarea } from "../primitives/textarea";
import { cn } from "../lib/utils";

type Bump = "patch" | "minor" | "major";

interface AgentMaterialLessonRow {
  id: string;
  title: string;
  moduleTitle: string;
  href: string;
  status: "draft" | "published";
  hasLayer: boolean;
  includedOnPublish: boolean;
}

interface AgentMaterialVersionRow {
  version: string;
  changelog: string;
  publishedAt: string;
  checksum: string;
  downloadHref: string;
}

interface AgentPublishInput {
  bump: Bump;
  changelog: string;
}

interface AgentMaterialLicense {
  label: string;
  text: string;
}

interface AgentMaterialPanelProps {
  lessons: AgentMaterialLessonRow[];
  versions: AgentMaterialVersionRow[];
  nextVersions: Record<Bump, string>;
  license: AgentMaterialLicense;
  onPublish(input: AgentPublishInput): Promise<string | null>;
  className?: string;
}

const bumpLabels: Record<Bump, string> = {
  patch: "Patch, for fixes",
  minor: "Minor, for new material",
  major: "Major, for changes that break earlier work",
};

function lessonBadge(lesson: AgentMaterialLessonRow) {
  if (lesson.includedOnPublish) return <Badge variant="success">Included</Badge>;
  if (lesson.hasLayer) return <Badge variant="warning">Lesson is a draft</Badge>;
  return <Badge variant="neutral">No agent material</Badge>;
}

function AgentMaterialPanel({
  lessons,
  versions,
  nextVersions,
  license,
  onPublish,
  className,
}: AgentMaterialPanelProps) {
  const [open, setOpen] = useState(false);
  const firstVersion = versions.length === 0;
  const [bump, setBump] = useState<Bump>(firstVersion ? "major" : "minor");
  const [changelog, setChangelog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const included = lessons.filter((lesson) => lesson.includedOnPublish).length;

  async function publish() {
    setPending(true);
    setError(null);
    const message = await onPublish({ bump, changelog });
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    setChangelog("");
    setOpen(false);
  }

  return (
    <section
      aria-labelledby="agent-material-heading"
      className={cn(
        "flex flex-col gap-4 rounded-(--card-radius) border border-border bg-surface shadow-(--card-shadow) p-4 md:p-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="agent-material-heading" className="flex items-center gap-2 text-lg text-text">
            <BotIcon className="size-5 text-text-muted" aria-hidden="true" />
            Agent material
          </h2>
          <p className="text-sm text-text-muted">
            Add a structured layer for agents in each lesson under For agents, then publish a
            version. Members&apos; agents read published versions only.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={included === 0}
          onClick={() => setOpen(true)}
        >
          <SendIcon className="size-4" aria-hidden="true" />
          Publish agent version
        </Button>
      </div>
      {lessons.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {lessons.map((lesson) => (
            <li
              key={lesson.id}
              className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <a
                href={lesson.href}
                className="min-w-0 flex-1 truncate text-text underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
              >
                {lesson.title}
                <span className="text-text-muted"> · {lesson.moduleTitle}</span>
              </a>
              {lessonBadge(lesson)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">Add lessons to this course first.</p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-medium text-text">Published versions</h3>
        {versions.length === 0 ? (
          <p className="text-sm text-text-muted">
            No versions yet. Published versions never change.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {versions.map((version) => (
              <li
                key={version.version}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-medium text-text tabular-nums">{version.version}</span>
                <span className="text-text-muted">{version.publishedAt}</span>
                <span className="min-w-0 flex-1 truncate text-text-muted">{version.changelog}</span>
                <a
                  href={version.downloadHref}
                  download
                  className="inline-flex min-h-11 items-center gap-1 font-medium text-text underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  Download skill {version.version}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish agent version</DialogTitle>
            <DialogDescription>
              {included === 1 ? "1 published lesson" : `${included} published lessons`} with agent
              material go into this version. It can&apos;t be changed later.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-4">
            {firstVersion ? (
              <p className="text-sm text-text">The first version is {nextVersions.major}.</p>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-text">Version</legend>
                {(Object.keys(bumpLabels) as Bump[]).map((option) => (
                  <label
                    key={option}
                    className="flex min-h-11 items-center gap-2 text-sm text-text"
                  >
                    <input
                      type="radio"
                      name="agent-version-bump"
                      value={option}
                      checked={bump === option}
                      onChange={() => setBump(option)}
                      className="size-4 accent-accent"
                    />
                    {nextVersions[option]} · {bumpLabels[option]}
                  </label>
                ))}
              </fieldset>
            )}
            <Field label="What changed" description="Optional. Up to 2,000 characters.">
              {(control) => (
                <Textarea
                  {...control}
                  value={changelog}
                  maxLength={2000}
                  rows={3}
                  onChange={(event) => setChangelog(event.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-text">License for agents: {license.label}</p>
              {license.text ? (
                <p className="whitespace-pre-line break-words text-text-muted">{license.text}</p>
              ) : null}
              <p className="text-text-muted">
                These are the course&apos;s agent access terms. Change them in Agent access before
                you publish. The version keeps the terms it was published with.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={() => void publish()}
            >
              {pending
                ? "Publishing…"
                : `Publish ${firstVersion ? nextVersions.major : nextVersions[bump]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export {
  AgentMaterialPanel,
  type AgentMaterialLicense,
  type AgentMaterialLessonRow,
  type AgentMaterialPanelProps,
  type AgentMaterialVersionRow,
  type AgentPublishInput,
};
