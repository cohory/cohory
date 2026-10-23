import type { SetupStep } from "@cohory/communities";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from "@cohory/ui";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import {
  loadSetupChecklist,
  nextStep,
  setupStepCopy,
  type ImportState,
  type OverviewViewer,
} from "../../../lib/manage/overview";
import { appUrl } from "../../../lib/manage/views";
import { PreviewAboutLink, SetupMarkButton, ShareLinkButton } from "./setup-step-actions";

const linkClass =
  "rounded-sm font-medium text-text underline-offset-4 outline-none hover:text-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function StepTitle({ step, slug }: { step: SetupStep; slug: string }) {
  const title = setupStepCopy[step.key].title;
  if (step.key === "preview") {
    return (
      <PreviewAboutLink slug={slug} href={step.href} className={linkClass}>
        {title}
      </PreviewAboutLink>
    );
  }
  return (
    <Link href={step.href} className={linkClass}>
      {title}
    </Link>
  );
}

function StepExtras({
  step,
  slug,
  importState,
}: {
  step: SetupStep;
  slug: string;
  importState: ImportState | null;
}) {
  if (step.done) return null;
  if (step.key === "import") {
    return (
      <div className="flex flex-col gap-2">
        {importState && !importState.available && importState.reason ? (
          <p className="text-sm text-text-muted">{importState.reason}</p>
        ) : null}
        <div>
          <SetupMarkButton slug={slug} mark="skip_import" label="I'm starting fresh" />
        </div>
      </div>
    );
  }
  if (step.key === "first_content") {
    return (
      <Link href={`/c/${encodeURIComponent(slug)}/calendar/new`} className={`text-sm ${linkClass}`}>
        Or schedule a call
      </Link>
    );
  }
  if (step.key === "share") {
    return (
      <div>
        <ShareLinkButton slug={slug} url={`${appUrl().replace(/\/$/, "")}/c/${slug}`} />
      </div>
    );
  }
  return null;
}

export async function SetupChecklistCard({ viewer }: { viewer: OverviewViewer }) {
  const checklist = await loadSetupChecklist(viewer);
  const total = checklist.steps.length;
  const next = nextStep(checklist);
  if (checklist.hidden || !next) {
    return null;
  }
  const paid = checklist.steps.some((step) => step.key === "price");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Set up your community</CardTitle>
        <CardDescription>
          {checklist.doneCount} of {total} done
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress
          value={Math.round((checklist.doneCount / total) * 100)}
          aria-label={`Setup: ${checklist.doneCount} of ${total} done`}
        />
        <ol className="flex flex-col divide-y divide-border">
          {checklist.steps.map((step) => (
            <li key={step.key} className="flex gap-3 py-3">
              {step.done ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-success"
                  strokeWidth={1.5}
                />
              ) : (
                <Circle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-text-muted"
                  strokeWidth={1.5}
                />
              )}
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className={step.done ? "text-text-muted line-through" : undefined}>
                  <StepTitle step={step} slug={viewer.slug} />
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </span>
                {step.done ? null : (
                  <p className="text-text-muted">{setupStepCopy[step.key].hint}</p>
                )}
                <StepExtras step={step} slug={viewer.slug} importState={checklist.importState} />
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          {next.key === "preview" ? (
            <Button asChild className="min-h-11">
              <PreviewAboutLink slug={viewer.slug} href={next.href}>
                Next: {setupStepCopy[next.key].title}
              </PreviewAboutLink>
            </Button>
          ) : (
            <Button asChild className="min-h-11">
              <Link href={next.href}>Next: {setupStepCopy[next.key].title}</Link>
            </Button>
          )}
          <SetupMarkButton slug={viewer.slug} mark="hide" label="Hide checklist" variant="ghost" />
        </div>
        {paid ? null : (
          <p className="text-sm text-text-muted">
            Want to charge for membership?{" "}
            <Link
              href={`/c/${encodeURIComponent(viewer.slug)}/manage/payments`}
              className={linkClass}
            >
              Set up payments
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
