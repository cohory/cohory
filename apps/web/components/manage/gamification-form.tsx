"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Switch,
  toast,
} from "@cohory/ui";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { saveGamificationAction } from "../../lib/manage/actions";
import { resetPointsAction } from "../../lib/manage/points-actions";
import { ConfirmDialog } from "./confirm-dialog";

const levelNameMaxLength = 30;

export function GamificationForm({
  slug,
  name,
  initial,
}: {
  slug: string;
  name: string;
  initial: {
    enabled: boolean;
    levelNames: string[];
    pointsForLessons: boolean;
    pointsForEvents: boolean;
  };
}) {
  const router = useRouter();
  const switchId = useId();
  const lessonsId = useId();
  const eventsId = useId();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [levelNames, setLevelNames] = useState(initial.levelNames);
  const [pointsForLessons, setPointsForLessons] = useState(initial.pointsForLessons);
  const [pointsForEvents, setPointsForEvents] = useState(initial.pointsForEvents);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resetting, setResetting] = useState(false);

  function rename(index: number, value: string) {
    setLevelNames((current) => current.map((name, i) => (i === index ? value : name)));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveGamificationAction({
        slug,
        enabled,
        levelNames,
        pointsForLessons,
        pointsForEvents,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast.success("Settings saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Points and levels</CardTitle>
        <CardDescription>
          Members earn points when others like their posts and comments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch id={switchId} checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor={switchId}>Show points and levels</Label>
          </div>
          {enabled ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-medium text-text">Also give 1 point for</legend>
              <div className="flex items-center gap-3">
                <Switch
                  id={lessonsId}
                  checked={pointsForLessons}
                  onCheckedChange={setPointsForLessons}
                />
                <Label htmlFor={lessonsId}>Each lesson a member finishes</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id={eventsId}
                  checked={pointsForEvents}
                  onCheckedChange={setPointsForEvents}
                />
                <Label htmlFor={eventsId}>Each event a member attends</Label>
              </div>
              <p className="text-sm text-text-muted">
                An event counts for members who said they are going, once it ends. Points for
                learning can take up to 15 minutes to show.
              </p>
            </fieldset>
          ) : null}
          {enabled ? (
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-medium text-text">Level names</legend>
              {levelNames.map((name, index) => (
                <Field key={index} label={`Level ${index + 1}`}>
                  {(control) => (
                    <Input
                      {...control}
                      value={name}
                      maxLength={levelNameMaxLength}
                      required
                      onChange={(event) => rename(index, event.target.value)}
                    />
                  )}
                </Field>
              ))}
            </fieldset>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11 self-start">
            {pending ? "Saving points…" : "Save points"}
          </Button>
        </form>
        <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm text-text-muted">
            Start everyone at zero points and level 1, for example after a season ends or after
            abuse. Past points stay in the history.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 self-start"
            onClick={() => setResetting(true)}
          >
            Reset points
          </Button>
        </div>
        <ConfirmDialog
          open={resetting}
          onOpenChange={setResetting}
          title="Reset everyone's points?"
          description="Every member goes back to zero points and level 1, and the leaderboard starts over. This can't be undone."
          confirmLabel="Reset points"
          pendingLabel="Resetting…"
          danger
          typeToConfirm={name}
          onConfirm={(typed) => resetPointsAction({ slug, confirmName: typed })}
          onDone={() => {
            toast.success("Points reset.");
            router.refresh();
          }}
        />
      </CardContent>
    </Card>
  );
}
