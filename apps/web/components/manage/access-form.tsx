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

import { saveAccessAction } from "../../lib/manage/join-actions";
import { RadioCards } from "./radio-cards";

type JoinMode = "open" | "approval" | "invite";

interface QuestionDraft {
  readonly key: number;
  readonly text: string;
  readonly required: boolean;
}

const maxQuestions = 3;

function QuestionRow({
  index,
  question,
  onChange,
  onRemove,
}: {
  index: number;
  question: QuestionDraft;
  onChange(next: QuestionDraft): void;
  onRemove(): void;
}) {
  const switchId = useId();
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <Field label={`Question ${index + 1}`}>
        {(control) => (
          <Input
            {...control}
            value={question.text}
            maxLength={200}
            required
            onChange={(event) => onChange({ ...question, text: event.target.value })}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Switch
            id={switchId}
            checked={question.required}
            onCheckedChange={(required) => onChange({ ...question, required })}
          />
          <Label htmlFor={switchId}>Answer required</Label>
        </div>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onRemove}>
          Remove question {index + 1}
        </Button>
      </div>
    </li>
  );
}

export const paidApprovalReason =
  "Paid communities: payment is the approval. Stop selling memberships to use Approval.";

export function AccessForm({
  slug,
  initial,
  planOnSale,
}: {
  slug: string;
  initial: {
    joinMode: JoinMode;
    joinQuestions: readonly { text: string; required: boolean }[];
  };
  planOnSale: boolean;
}) {
  const router = useRouter();
  const [joinMode, setJoinMode] = useState<JoinMode>(initial.joinMode);
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    initial.joinQuestions.map((question, key) => ({ key, ...question })),
  );
  const [nextKey, setNextKey] = useState(initial.joinQuestions.length);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveAccessAction({
        slug,
        joinMode,
        joinQuestions: questions.map(({ text, required }) => ({ text, required })),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast.success("Join settings saved.");
      router.refresh();
    });
  }

  function addQuestion() {
    setQuestions((current) => [...current, { key: nextKey, text: "", required: false }]);
    setNextKey((key) => key + 1);
  }

  return (
    <Card id="access">
      <CardHeader>
        <CardTitle className="text-lg">Joining</CardTitle>
        <CardDescription>
          {planOnSale
            ? "Choose how new people get in. Everyone pays before they join, invite links included."
            : "Choose how new people get in. Invite links always work."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-6">
          <RadioCards
            legend="How people join"
            name="joinMode"
            value={joinMode}
            onChange={setJoinMode}
            options={[
              { value: "open", label: "Open", description: "Anyone signed in can join at once." },
              {
                value: "approval",
                label: "Approval",
                description: planOnSale
                  ? paidApprovalReason
                  : "People send a request. Moderators and admins approve it.",
                disabled: planOnSale,
              },
              {
                value: "invite",
                label: "Invite only",
                description: planOnSale
                  ? "Only people with an invite link can buy a membership."
                  : "Only people with an invite link can join.",
              },
            ]}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-text">Join questions</legend>
            <p className="text-sm text-text-muted">
              {planOnSale
                ? "Asked before checkout. Up to three questions. Only moderators, admins, and you see the answers."
                : "Shown with Request to join. Up to three questions. Only moderators, admins, and you see the answers."}
            </p>
            {questions.length > 0 ? (
              <ol className="flex flex-col gap-3">
                {questions.map((question, index) => (
                  <QuestionRow
                    key={question.key}
                    index={index}
                    question={question}
                    onChange={(next) =>
                      setQuestions((current) =>
                        current.map((item) => (item.key === next.key ? next : item)),
                      )
                    }
                    onRemove={() =>
                      setQuestions((current) => current.filter((item) => item.key !== question.key))
                    }
                  />
                ))}
              </ol>
            ) : null}
            {questions.length < maxQuestions ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 self-start"
                onClick={addQuestion}
              >
                Add a question
              </Button>
            ) : null}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11 self-start">
            {pending ? "Saving…" : "Save join settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
