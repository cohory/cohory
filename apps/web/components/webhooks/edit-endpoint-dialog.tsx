"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from "@cohory/ui";
import { useRouter } from "next/navigation";

import { updateWebhookEndpointAction } from "../../lib/webhooks/actions";
import type { EndpointRow } from "../../lib/webhooks/views";
import { EndpointForm } from "./endpoint-form";

export function EditEndpointDialog({
  slug,
  endpoint,
  disabled,
  onClose,
}: {
  slug: string;
  endpoint: EndpointRow;
  disabled: boolean;
  onClose(): void;
}) {
  const router = useRouter();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit endpoint</DialogTitle>
          <DialogDescription>
            The secret and the delivery log stay the same. Waiting deliveries go to the new URL.
          </DialogDescription>
        </DialogHeader>
        <EndpointForm
          label="Edit endpoint"
          initial={{
            url: endpoint.url,
            description: endpoint.description ?? "",
            eventTypes: endpoint.eventTypes,
          }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          disabled={disabled}
          onCancel={onClose}
          onSubmit={async (fields) => {
            const result = await updateWebhookEndpointAction({
              slug,
              endpointId: endpoint.id,
              ...fields,
            });
            if (result.ok) {
              toast.success("Endpoint saved.");
              onClose();
              router.refresh();
            }
            return result;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
