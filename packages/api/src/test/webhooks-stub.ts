import type { WebhooksService } from "@cohory/webhooks";
import { vi, type Mock } from "vitest";

export type WebhooksStub = { [K in keyof WebhooksService]: Mock<WebhooksService[K]> };

export function createWebhooksStub(): WebhooksStub {
  return {
    listEndpoints: vi.fn<WebhooksService["listEndpoints"]>(),
    getEndpoint: vi.fn<WebhooksService["getEndpoint"]>(),
    createEndpoint: vi.fn<WebhooksService["createEndpoint"]>(),
    updateEndpoint: vi.fn<WebhooksService["updateEndpoint"]>(),
    rotateSecret: vi.fn<WebhooksService["rotateSecret"]>(),
    disableEndpoint: vi.fn<WebhooksService["disableEndpoint"]>(),
    enableEndpoint: vi.fn<WebhooksService["enableEndpoint"]>(),
    deleteEndpoint: vi.fn<WebhooksService["deleteEndpoint"]>(),
    sendTestEvent: vi.fn<WebhooksService["sendTestEvent"]>(),
    listDeliveries: vi.fn<WebhooksService["listDeliveries"]>(),
    getDelivery: vi.fn<WebhooksService["getDelivery"]>(),
    resendDelivery: vi.fn<WebhooksService["resendDelivery"]>(),
    resendFailedDeliveries: vi.fn<WebhooksService["resendFailedDeliveries"]>(),
  };
}
