"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from "@cohory/ui";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { dismissWelcomeAction } from "../../lib/onboarding/actions";
import type { WelcomeStep } from "../../lib/onboarding/welcome";

const linkClass =
  "rounded-sm font-medium text-text underline-offset-4 outline-none hover:text-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export interface ChecklistItem {
  readonly key: string;
  readonly title: string;
  readonly done: boolean;
  readonly href: string;
}

export function StepList({ steps }: { steps: readonly ChecklistItem[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((step) => (
        <li key={step.key} className="flex min-h-11 items-center gap-3 text-sm">
          {step.done ? (
            <CheckCircle2
              aria-hidden="true"
              className="size-5 shrink-0 text-success"
              strokeWidth={1.5}
            />
          ) : (
            <Circle
              aria-hidden="true"
              className="size-5 shrink-0 text-text-muted"
              strokeWidth={1.5}
            />
          )}
          {step.done ? (
            <span className="text-text-muted line-through">{step.title}</span>
          ) : (
            <Link href={step.href} className={linkClass}>
              {step.title}
            </Link>
          )}
          <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
        </li>
      ))}
    </ol>
  );
}

export function WelcomeCard({
  slug,
  communityName,
  steps,
}: {
  slug: string;
  communityName: string;
  steps: readonly WelcomeStep[];
}) {
  const [pending, startTransition] = useTransition();
  const done = steps.filter((step) => step.done).length;

  return (
    <Card aria-labelledby="welcome-card-title">
      <CardHeader>
        <CardTitle as="h2" id="welcome-card-title" className="text-lg">
          Start here
        </CardTitle>
        <CardDescription>
          Welcome to {communityName}. {done} of {steps.length} done.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <StepList steps={steps} />
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await dismissWelcomeAction({ slug });
              if (!result.ok) toast.error(result.message);
            })
          }
        >
          Hide this
        </Button>
      </CardContent>
    </Card>
  );
}
