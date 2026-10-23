export type WebhooksErrorCode = "not_found" | "endpoint_limit_reached" | "endpoint_disabled";

export class WebhooksError extends Error {
  constructor(
    readonly code: WebhooksErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebhooksError";
  }
}

export class WebhookEndpointNotFoundError extends WebhooksError {
  constructor() {
    super("not_found", "webhook endpoint not found");
    this.name = "WebhookEndpointNotFoundError";
  }
}

export class WebhookDeliveryNotFoundError extends WebhooksError {
  constructor() {
    super("not_found", "webhook delivery not found");
    this.name = "WebhookDeliveryNotFoundError";
  }
}

export class WebhookEndpointLimitError extends WebhooksError {
  constructor(readonly limit: number) {
    super("endpoint_limit_reached", `a community can have ${limit} webhook endpoints`);
    this.name = "WebhookEndpointLimitError";
  }
}

export class WebhookEndpointDisabledError extends WebhooksError {
  constructor() {
    super("endpoint_disabled", "webhook endpoint is disabled");
    this.name = "WebhookEndpointDisabledError";
  }
}
