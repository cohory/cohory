"use client";

import { Alert, AlertDescription, Button, Field, Input } from "@cohory/ui";
import { useFocusFirstError } from "@cohory/ui/lib/use-focus-first-error";
import { useUnsavedChanges } from "@cohory/ui/lib/use-unsaved-changes";
import { cn } from "@cohory/ui/lib/utils";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { SlugAvailability } from "../../../../lib/communities/slug-availability";
import { checkSlugAction, createCommunityAction, type CreateCommunityState } from "./actions";
import { communitySlugField, suggestSlug, type CreateCommunityField } from "./schema";

const initialState: CreateCommunityState = { status: "idle" };

const createFailedMessage =
  "We couldn't create the community. Check your connection and try again.";

async function submitCommunity(
  previous: CreateCommunityState,
  formData: FormData,
): Promise<CreateCommunityState> {
  try {
    return await createCommunityAction(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    const text = (name: string) => {
      const value = formData.get(name);
      return typeof value === "string" ? value : "";
    };
    return {
      status: "error",
      fieldErrors: {},
      message: createFailedMessage,
      values: {
        description: text("description"),
        privacy: text("privacy"),
        pricing: text("pricing"),
      },
    };
  }
}

const privacyOptions = [
  {
    value: "private",
    label: "Private",
    description: "Only members see posts, courses, and events. Others see the About page.",
  },
  {
    value: "public",
    label: "Public",
    description: "Anyone with the link can read the community and join.",
  },
] as const;

const pricingOptions = [
  {
    value: "free",
    label: "Free",
    description: "Anyone you let in joins at no cost.",
  },
  {
    value: "paid",
    label: "Paid",
    description: "Set up payments next. It stays free to join until a plan is on sale.",
  },
] as const;

const slugCheckDelayMs = 300;

type SlugCheck =
  { readonly status: "checking" } | { readonly status: "done"; readonly result: SlugAvailability };

function useSlugCheck(slug: string): SlugCheck | null {
  const [checked, setChecked] = useState<{
    slug: string;
    result: SlugAvailability | null;
  } | null>(null);
  const valid = communitySlugField.safeParse(slug).success;

  useEffect(() => {
    if (!valid) {
      return;
    }
    let current = true;
    const settle = (result: SlugAvailability | null) => {
      if (current) {
        setChecked({ slug, result });
      }
    };
    const timer = setTimeout(() => {
      checkSlugAction(slug).then(settle, () => settle(null));
    }, slugCheckDelayMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [slug, valid]);

  if (!valid) {
    return null;
  }
  if (checked?.slug !== slug) {
    return { status: "checking" };
  }
  return checked.result ? { status: "done", result: checked.result } : null;
}

const unavailableMessages = {
  taken: "That URL is already taken.",
  reserved: "That URL is reserved.",
} as const;

function SlugStatus({
  check,
  onPick,
}: {
  check: SlugCheck | null;
  onPick: (slug: string) => void;
}) {
  const result = check?.status === "done" ? check.result : null;
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="text-sm text-text-muted empty:hidden">
        {check?.status === "checking" ? "Checking the URL…" : null}
        {result?.status === "available" ? "This URL is available." : null}
        {result && result.status !== "available"
          ? `${unavailableMessages[result.status]}${
              result.suggestions.length > 0 ? " Try one of these:" : " Try a different one."
            }`
          : null}
      </p>
      {result && result.status !== "available" && result.suggestions.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Suggested addresses">
          {result.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => onPick(suggestion)}
              >
                {suggestion}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CreateCommunityForm({
  address,
  guidelinesHref = null,
}: {
  address: string;
  guidelinesHref?: string | null;
}) {
  const [state, action, pending] = useActionState(submitCommunity, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const errorFor = (key: CreateCommunityField) =>
    state.status === "error" ? state.fieldErrors[key] : undefined;
  const privacyError = errorFor("privacy");
  const values = state.status === "error" ? state.values : null;
  const privacy = values?.privacy || "private";
  const pricing = values?.pricing || "free";
  const slugCheck = useSlugCheck(slug);
  const formRef = useFocusFirstError<HTMLFormElement>(
    state.status === "error" ? state.fieldErrors : null,
  );
  useUnsavedChanges(name.trim() !== "" && !pending);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="danger">
          <AlertDescription className="text-text">{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field label="Name" error={errorFor("name")}>
        {(control) => (
          <Input
            {...control}
            name="name"
            required
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!slugEdited) {
                setSlug(suggestSlug(event.target.value));
              }
            }}
          />
        )}
      </Field>

      <Field
        label="URL"
        description={
          <>
            Your community will live at{" "}
            <span className="break-all font-medium text-text">
              {address}/c/{slug || "your-url"}
            </span>
          </>
        }
        error={errorFor("slug")}
      >
        {(control) => (
          <Input
            {...control}
            name="slug"
            required
            minLength={3}
            maxLength={48}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={slug}
            onChange={(event) => {
              setSlugEdited(event.target.value !== "");
              setSlug(event.target.value.toLowerCase());
            }}
          />
        )}
      </Field>
      <SlugStatus
        check={slugCheck}
        onPick={(picked) => {
          setSlugEdited(true);
          setSlug(picked);
        }}
      />

      <Field label="Description (optional)" error={errorFor("description")}>
        {(control) => (
          <textarea
            {...control}
            name="description"
            defaultValue={values?.description}
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border border-input bg-surface px-3 py-2 text-base text-text outline-none placeholder:text-text-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-danger sm:text-sm"
          />
        )}
      </Field>

      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={privacyError ? "privacy-error" : undefined}
      >
        <legend className="mb-2 text-sm font-medium text-text">Who can see it</legend>
        {privacyOptions.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-muted",
            )}
          >
            <input
              type="radio"
              name="privacy"
              value={option.value}
              defaultChecked={option.value === privacy}
              aria-invalid={privacyError ? true : undefined}
              className="mt-1 size-4 accent-(--color-accent)"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-text">{option.label}</span>
              <span className="text-sm text-text">{option.description}</span>
            </span>
          </label>
        ))}
        {privacyError ? (
          <p id="privacy-error" className="text-sm text-danger">
            {privacyError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-text">Free or paid</legend>
        {pricingOptions.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-muted"
          >
            <input
              type="radio"
              name="pricing"
              value={option.value}
              defaultChecked={option.value === pricing}
              className="mt-1 size-4 accent-(--color-accent)"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-text">{option.label}</span>
              <span className="text-sm text-text">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {guidelinesHref ? (
        <p className="text-sm text-text-muted">
          By creating a community you agree to the{" "}
          <a href={guidelinesHref} className="text-link">
            Community Guidelines
          </a>
          .
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="min-h-11 self-start">
        {pending ? "Creating community…" : "Create community"}
      </Button>
    </form>
  );
}
