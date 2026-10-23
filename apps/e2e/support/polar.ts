import { randomBytes } from "node:crypto";

import { expect } from "@playwright/test";

export const fakePolarUrl = process.env.E2E_FAKE_POLAR_URL ?? "http://127.0.0.1:3313";
const appPort = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3310").port || "3310";
const appUrlForPolar = process.env.E2E_POLAR_APP_URL ?? `http://web:${appPort}`;

export const polarHost = new RegExp(`^${fakePolarUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`);

export interface PolarCall {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64")}`;
}

// Inside the Compose stack the fake Polar server reaches the app by its service name, not localhost.
export async function registerPolarEndpoint(webhookPath: string, secret: string): Promise<void> {
  const response = await fetch(`${fakePolarUrl}/__fixtures/webhook-endpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `${appUrlForPolar}${webhookPath}`, secret }),
  });
  expect(response.ok, "fake Polar saves the webhook endpoint").toBe(true);
}

export async function polarCalls(): Promise<PolarCall[]> {
  const response = await fetch(`${fakePolarUrl}/__fixtures/calls`);
  expect(response.ok, "fake Polar lists calls").toBe(true);
  return (await response.json()) as PolarCall[];
}
