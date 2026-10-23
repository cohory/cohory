"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  composeDocument,
  Field,
  Input,
  Textarea,
  toast,
} from "@cohory/ui";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { saveAboutAction } from "../../lib/manage/about-actions";
import { FaqFields, WhatYouGetFields, type FaqDraft } from "./about-list-fields";

const descriptionMax = 2000;
const detailedMax = 20_000;

export interface AboutEditorInitial {
  readonly description: string;
  readonly whatYouGet: readonly string[];
  readonly detailedText: string;
  readonly hostBio: string;
  readonly hostCredential: string;
  readonly faq: readonly FaqDraft[];
}

export interface AboutLimits {
  readonly whatYouGetItems: number;
  readonly whatYouGetLength: number;
  readonly hostBioLength: number;
  readonly hostCredentialLength: number;
  readonly faqItems: number;
  readonly faqQuestionLength: number;
  readonly faqAnswerLength: number;
}

export function AboutEditor({
  slug,
  initial,
  limits,
}: {
  slug: string;
  initial: AboutEditorInitial;
  limits: AboutLimits;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(initial.description);
  const [whatYouGet, setWhatYouGet] = useState<string[]>([...initial.whatYouGet]);
  const [detailedText, setDetailedText] = useState(initial.detailedText);
  const [hostBio, setHostBio] = useState(initial.hostBio);
  const [hostCredential, setHostCredential] = useState(initial.hostCredential);
  const [faq, setFaq] = useState<FaqDraft[]>([...initial.faq]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edited =
    JSON.stringify([description, whatYouGet, detailedText, hostBio, hostCredential, faq]) !==
    JSON.stringify([
      initial.description,
      initial.whatYouGet,
      initial.detailedText,
      initial.hostBio,
      initial.hostCredential,
      initial.faq,
    ]);
  useUnsavedChanges(edited && !pending);

  function save(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const document = composeDocument(detailedText.trim(), [], [], {
        resolveMention: () => null,
        headings: true,
      });
      const result = await saveAboutAction(slug, {
        description,
        whatYouGet,
        hostBio,
        hostCredential,
        faq,
        document,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      toast.success("About page saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Page text</CardTitle>
        <CardDescription>
          Everything a visitor reads before they join, saved together.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-6">
          <Field
            label="Short description"
            description="One or two lines next to the join button, also used for link previews."
          >
            {(control) => (
              <Textarea
                {...control}
                value={description}
                maxLength={descriptionMax}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
          <WhatYouGetFields
            lines={whatYouGet}
            max={limits.whatYouGetItems}
            maxLength={limits.whatYouGetLength}
            onChange={setWhatYouGet}
          />
          <Field
            label="Detailed description"
            description="The full story, under What you get. Start a line with ## for a heading. Use **bold**, *italic*, and lines that start with a dash for lists. YouTube, Vimeo, and Loom links become videos."
          >
            {(control) => (
              <Textarea
                {...control}
                value={detailedText}
                maxLength={detailedMax}
                rows={10}
                className="min-h-48 resize-y"
                onChange={(event) => setDetailedText(event.target.value)}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-text">About the host</legend>
            <p className="text-sm text-text-muted">
              Shown with your profile photo. Leave both empty to hide the block.
            </p>
            <Field label="Credential" description="One line, for example what you have built.">
              {(control) => (
                <Input
                  {...control}
                  value={hostCredential}
                  maxLength={limits.hostCredentialLength}
                  onChange={(event) => setHostCredential(event.target.value)}
                />
              )}
            </Field>
            <Field label="Bio">
              {(control) => (
                <Textarea
                  {...control}
                  value={hostBio}
                  maxLength={limits.hostBioLength}
                  rows={3}
                  onChange={(event) => setHostBio(event.target.value)}
                />
              )}
            </Field>
          </fieldset>
          <FaqFields
            items={faq}
            max={limits.faqItems}
            questionMax={limits.faqQuestionLength}
            answerMax={limits.faqAnswerLength}
            onChange={setFaq}
          />
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11 self-start">
            {pending ? "Saving…" : "Save About page"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
