"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, toast } from "@cohory/ui";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { saveGeneralAction } from "../../lib/manage/actions";
import { ConfirmDialog } from "./confirm-dialog";
import { RadioCards } from "./radio-cards";

type Privacy = "private" | "public";

const privacyChange: Readonly<
  Record<Privacy, { title: string; description: string; confirmLabel: string }>
> = {
  public: {
    title: "public",
    description:
      "Anyone can read every post and comment, including older ones, and search engines can list them. Members' names show next to their posts.",
    confirmLabel: "Make public",
  },
  private: {
    title: "private",
    description:
      "Only members can see posts, courses, and events. Links to posts that people shared will ask people to sign in.",
    confirmLabel: "Make private",
  },
};

export function GeneralForm({
  slug,
  initial,
}: {
  slug: string;
  initial: { name: string; privacy: Privacy };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [privacy, setPrivacy] = useState<Privacy>(initial.privacy);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const change = privacyChange[privacy];
  useUnsavedChanges(!pending && (name !== initial.name || privacy !== initial.privacy));

  function saved() {
    setError(null);
    toast.success("Settings saved.");
    router.refresh();
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (privacy !== initial.privacy) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const result = await saveGeneralAction({ slug, name, privacy });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      saved();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">General</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label="Community name">
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={80}
                required
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <RadioCards
            legend="Who can see your community"
            name="privacy"
            columns={2}
            value={privacy}
            onChange={setPrivacy}
            options={[
              {
                value: "private",
                label: "Private",
                description: "Only members see posts, courses, and events.",
              },
              {
                value: "public",
                label: "Public",
                description:
                  "Anyone can read posts and comments, older ones too. Only members can take part.",
              },
            ]}
          />
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11 self-start">
            {pending ? "Saving settings…" : "Save settings"}
          </Button>
        </form>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Make ${initial.name} ${change.title}?`}
          description={change.description}
          confirmLabel={change.confirmLabel}
          pendingLabel="Saving…"
          onConfirm={() => saveGeneralAction({ slug, name, privacy })}
          onDone={saved}
        />
      </CardContent>
    </Card>
  );
}
