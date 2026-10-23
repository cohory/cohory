"use client";

import type { FieldErrors, FormResult } from "@cohory/auth/forms";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { authErrorMessage } from "./errors";

type SubmitResult = { error: { code?: string | undefined; status: number } | null };

type FormError = { message: string; code: string | undefined };

type AuthFormOptions<T> = {
  parse: (formData: FormData) => FormResult<T>;
  submit: (data: T) => Promise<SubmitResult>;
  onSuccess: (data: T) => void;
};

export function useAuthForm<T>({ parse, submit, onSuccess }: AuthFormOptions<T>) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormError | undefined>();
  const [pending, setPending] = useState(false);
  const formErrorRef = useRef<HTMLDivElement>(null);

  // The submit button is disabled while pending, so without this focus falls back to the body.
  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = parse(new FormData(form));
    setFormError(undefined);

    if (!parsed.success) {
      setFieldErrors(parsed.fieldErrors);
      const [firstInvalid] = Object.keys(parsed.fieldErrors);
      const element = firstInvalid ? form.elements.namedItem(firstInvalid) : null;
      if (element instanceof HTMLElement) {
        element.focus();
      }
      return;
    }

    setFieldErrors({});
    setPending(true);
    try {
      const { error } = await submit(parsed.data);
      if (error) {
        setFormError({ message: authErrorMessage(error), code: error.code });
        setPending(false);
        return;
      }
    } catch {
      setFormError({ message: authErrorMessage({ status: 0 }), code: undefined });
      setPending(false);
      return;
    }
    onSuccess(parsed.data);
  }

  return {
    fieldErrors,
    formError: formError?.message,
    formErrorCode: formError?.code,
    formErrorRef,
    pending,
    onSubmit,
  };
}
