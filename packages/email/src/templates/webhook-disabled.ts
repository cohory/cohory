import { instanceName } from "../brand";
import type { EmailContent } from "../message";
import { buildEmail, communityBrand, type CommunityBrandInput } from "./layout";

type WebhookEndpointDisabledInput = {
  communityName: string;
  endpointHost: string;
  url: string;
  communityBrand?: CommunityBrandInput;
};

export function webhookEndpointDisabledEmail({
  communityName,
  endpointHost,
  url,
  communityBrand: brand,
}: WebhookEndpointDisabledInput): EmailContent {
  return buildEmail({
    template: "webhook-endpoint-disabled",
    subject: "A webhook endpoint was turned off",
    preheader: `Every delivery to ${endpointHost} failed for 3 days.`,
    brand: communityBrand(communityName, brand),
    body: [
      `We turned off the webhook endpoint at ${endpointHost} for ${communityName}. Every delivery to it failed for 3 days, so events stopped going out.`,
      "Check that the receiver is online and answers with a 2xx status, then turn the endpoint back on in Manage, Settings, Webhooks. Events from while it was off are not sent again.",
    ],
    cta: { label: "Open Webhooks", url },
    footer: {
      why: `You received this email because you own ${communityName} on ${instanceName()}.`,
    },
  });
}
