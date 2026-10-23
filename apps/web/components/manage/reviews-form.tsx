"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  toast,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { saveReviewsSettingAction } from "../../lib/reviews/actions";

export function ReviewsForm({ slug, initial }: { slug: string; initial: boolean }) {
  const router = useRouter();
  const switchId = useId();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveReviewsSettingAction({ slug, enabled });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast.success(enabled ? "Reviews are on." : "Reviews are off.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Reviews</CardTitle>
        <CardDescription>
          Members who have paid for at least 30 days can leave a review on your About page: 1 to 5
          stars and a short text. Trials, past due payments, one time purchases, and free access do
          not count. You can reply to each review once. You can hide a review only after someone
          reports it. Turning reviews off hides them but keeps them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch id={switchId} checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor={switchId}>Show reviews on the About page</Label>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="min-h-11 self-start" disabled={pending}>
            Save reviews setting
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
