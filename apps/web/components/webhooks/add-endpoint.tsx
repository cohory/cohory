"use client";

import { Button, Card, CardContent, CardHeader, CardTitle } from "@cohory/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createWebhookEndpointAction } from "../../lib/webhooks/actions";
import { EndpointForm } from "./endpoint-form";
import { SecretReveal } from "./secret-reveal";

export function AddEndpoint({ slug, disabled }: { slug: string; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  if (secret) {
    return (
      <SecretReveal
        secret={secret}
        onDone={() => {
          setSecret(null);
          router.refresh();
        }}
      />
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        className="min-h-11 self-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden="true" className="size-4" strokeWidth={1.5} />
        Add endpoint
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h5" className="text-lg">
          Add an endpoint
        </CardTitle>
      </CardHeader>
      <CardContent>
        <EndpointForm
          label="Add an endpoint"
          submitLabel="Add endpoint"
          pendingLabel="Adding endpoint…"
          disabled={disabled}
          onCancel={() => setOpen(false)}
          onSubmit={async (fields) => {
            const result = await createWebhookEndpointAction({
              slug,
              url: fields.url,
              description: fields.description || undefined,
              eventTypes: fields.eventTypes,
            });
            if (result.ok) {
              setOpen(false);
              setSecret(result.data.secret);
            }
            return result;
          }}
        />
      </CardContent>
    </Card>
  );
}
