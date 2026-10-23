"use client";

import { Button, Field, Input } from "@cohory/ui";
import { useFocusFirstError } from "@cohory/ui/lib/use-focus-first-error";
import { unstable_rethrow } from "next/navigation";
import { useActionState } from "react";

import { updateProfile, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = { status: "idle" };

async function saveProfile(
  previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  try {
    return await updateProfile(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    const name = formData.get("name");
    return {
      status: "error",
      field: "form",
      message: "We couldn't save your changes. Check your connection and try again.",
      name: typeof name === "string" ? name : "",
    };
  }
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(saveProfile, initialState);
  const errorFor = (field: "name" | "avatar" | "form") =>
    state.status === "error" && state.field === field ? state.message : null;
  const nameError = errorFor("name");
  const avatarError = errorFor("avatar");
  const formError = errorFor("form");
  const formRef = useFocusFirstError<HTMLFormElement>(state.status === "error" ? state : null);

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
      <Field label="Name" error={nameError ?? undefined}>
        {(control) => (
          <Input
            {...control}
            name="name"
            defaultValue={state.status === "error" ? state.name : name}
            required
            maxLength={80}
            autoComplete="name"
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <label htmlFor="avatar" className="text-sm font-medium text-text">
          Avatar
        </label>
        <input
          id="avatar"
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-invalid={avatarError ? true : undefined}
          aria-describedby={avatarError ? "avatar-error avatar-hint" : "avatar-hint"}
          className="text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text"
        />
        <p id="avatar-hint" className="text-sm text-text-muted">
          PNG, JPEG, WebP, or GIF, up to 5 MB.
        </p>
        {avatarError ? (
          <p id="avatar-error" className="text-sm text-danger">
            {avatarError}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving changes…" : "Save changes"}
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {state.status === "saved" ? state.message : null}
        </p>
      </div>
    </form>
  );
}
