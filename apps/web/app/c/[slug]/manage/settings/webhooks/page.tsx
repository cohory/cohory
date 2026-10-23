import { can } from "@cohory/authz";
import { getManageService } from "@cohory/communities";
import { getPlatformConfig } from "@cohory/config/platform";
import {
  getWebhooksService,
  sampleWebhookPayloads,
  WebhookEndpointNotFoundError,
} from "@cohory/webhooks";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AddEndpoint } from "../../../../../../components/webhooks/add-endpoint";
import { DeliveryLog } from "../../../../../../components/webhooks/delivery-log";
import { EndpointCard } from "../../../../../../components/webhooks/endpoint-card";
import { ReceiverGuide } from "../../../../../../components/webhooks/receiver-guide";
import { requireManagePage } from "../../../../../../lib/manage/load";
import { toDeliveryRow, toEndpointRow } from "../../../../../../lib/webhooks/views";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage({
  params,
  searchParams,
}: PageProps<"/c/[slug]/manage/settings/webhooks">) {
  const manage = await requireManagePage((await params).slug, "settings");
  if (!can(manage.actor, "manage", "webhook", { role: manage.role })) {
    notFound();
  }
  const query = await searchParams;
  const service = getWebhooksService();
  const [endpoints, settings] = await Promise.all([
    service.listEndpoints(manage.actor, manage.communityId),
    getManageService().getSettings(manage.actor, manage.communityId),
  ]);
  const archived = settings.archivedAt !== null;
  const requested = typeof query.endpoint === "string" ? query.endpoint : null;
  const selected = endpoints.find((endpoint) => endpoint.id === requested) ?? endpoints[0] ?? null;
  let deliveries = null;
  if (selected) {
    try {
      deliveries = await service.listDeliveries(manage.actor, manage.communityId, selected.id);
    } catch (error) {
      if (!(error instanceof WebhookEndpointNotFoundError)) throw error;
    }
  }

  const samples = Object.fromEntries(
    Object.entries(sampleWebhookPayloads()).map(([type, payload]) => [
      type,
      JSON.stringify(payload, null, 2),
    ]),
  );

  return (
    <>
      <h3 className="text-2xl font-semibold text-text">Webhooks</h3>
      <p className="text-sm text-text-muted">
        Send events from this community to another app, such as Zapier, n8n, or your own server.
        Each request carries ids only and is signed with the endpoint&apos;s secret, so the receiver
        can check it came from {getPlatformConfig().instance.name}. Failed deliveries are retried
        for up to 3 days.
      </p>
      <ReceiverGuide samples={samples} />
      <section aria-labelledby="endpoints-heading" className="flex flex-col gap-4">
        <h4 id="endpoints-heading" className="text-lg font-semibold text-text">
          Endpoints
        </h4>
        {endpoints.length === 0 ? (
          <p className="text-sm text-text-muted">No endpoints yet.</p>
        ) : (
          endpoints.map((endpoint) => (
            <EndpointCard
              key={endpoint.id}
              slug={manage.slug}
              endpoint={toEndpointRow(endpoint)}
              selected={endpoint.id === selected?.id}
              archived={archived}
            />
          ))
        )}
        <AddEndpoint slug={manage.slug} disabled={archived} />
      </section>
      {selected && deliveries ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm text-text-muted">
            Showing deliveries to <span className="font-mono break-all">{selected.url}</span>
          </p>
          <DeliveryLog
            key={selected.id}
            slug={manage.slug}
            endpointId={selected.id}
            active={selected.status === "active" && !archived}
            initialRows={deliveries.data.map(toDeliveryRow)}
            initialCursor={deliveries.nextCursor}
          />
        </div>
      ) : null}
    </>
  );
}
