"use client";

import { Alert, Button, Field, Input, Select, Textarea } from "@cohory/ui";
import { useActionState } from "react";

import { sendContactMessage, type ContactState } from "../../../lib/contact/actions";

export interface ContactFormProps {
  readonly token: string;
  readonly topics: readonly string[];
  readonly sender: { readonly name: string; readonly email: string } | null;
  readonly prefill: { readonly topic: string | null; readonly link: string | null };
}

const accountValue = "read-only:bg-surface-hover read-only:text-text-muted";

export function ContactForm({ token, topics, sender, prefill }: ContactFormProps) {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContactMessage, {
    status: "idle",
    token,
  });

  if (state.status === "sent") {
    return <Alert variant="success">Thanks. Your message was sent. Replies come by email.</Alert>;
  }

  const values = state.status === "error" ? state.values : null;

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      <input type="hidden" name="token" value={state.token} />
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <Field label="Name" description={sender ? "From your account." : undefined}>
        {(control) => (
          <Input
            {...control}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            readOnly={sender !== null}
            className={accountValue}
            defaultValue={sender?.name ?? values?.name ?? ""}
          />
        )}
      </Field>
      <Field
        label="Email"
        description={
          sender ? "From your account. We reply to this address." : "We reply to this address."
        }
      >
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            readOnly={sender !== null}
            className={accountValue}
            defaultValue={sender?.email ?? values?.email ?? ""}
          />
        )}
      </Field>
      <Field label="Topic">
        {(control) => (
          <Select
            {...control}
            name="topic"
            required
            defaultValue={values?.topic ?? prefill.topic ?? ""}
          >
            <option value="" disabled>
              Choose a topic
            </option>
            {topics.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Message" description="Between 10 and 5000 characters.">
        {(control) => (
          <Textarea
            {...control}
            name="message"
            rows={6}
            required
            minLength={10}
            maxLength={5000}
            defaultValue={values?.message ?? ""}
          />
        )}
      </Field>
      <Field
        label="Page or community link (optional)"
        description="Paste the address if your message is about a specific page."
      >
        {(control) => (
          <Input
            {...control}
            name="link"
            type="url"
            inputMode="url"
            maxLength={2000}
            defaultValue={values?.link ?? prefill.link ?? ""}
          />
        )}
      </Field>
      <Button type="submit" className="min-h-11 self-start" disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
