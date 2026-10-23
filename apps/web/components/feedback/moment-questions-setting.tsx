"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch } from "@cohory/ui";
import { useId, useState, useTransition } from "react";

import { setMomentQuestionsAction } from "../../lib/feedback/actions";

export function MomentQuestionsSetting({ asking }: { asking: boolean }) {
  const labelId = useId();
  const [checked, setChecked] = useState(asking);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setError(null);
    setSaved(false);
    setChecked(next);
    startTransition(async () => {
      const result = await setMomentQuestionsAction(next);
      if (!result.ok) {
        setChecked(!next);
        setError(result.message);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-lg">
          Questions from Cohory
        </CardTitle>
        <CardDescription>
          After your first post, first paid member, and first course, we may ask one short question
          about how easy it was. At most one question a month. Only the Cohory team reads the
          answers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <span id={labelId} className="text-sm text-text">
            Ask me how setup went
          </span>
          <Switch
            aria-labelledby={labelId}
            checked={checked}
            disabled={pending}
            aria-busy={pending || undefined}
            onCheckedChange={change}
          />
        </div>
        <p role="status" className="text-sm text-text-muted">
          {pending ? "Saving…" : saved ? "Saved." : null}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
