# Outbound webhooks

Status: Draft, 2026-10-22

How cohory sends community events to other apps, and how a receiver checks that a request is genuine.

Available since 0.6.0 (REQ-AGT-007). Design notes are in [agent-integrations.md](../architecture/agent-integrations.md) section 6.

## Set up an endpoint

1. In the community, open Manage, Settings, Webhooks. Owners and admins see this page. The endpoints come first; "How to verify requests" opens the verify code from this guide and a sample payload for each event.
2. Select Add endpoint, enter an https URL that accepts `POST` requests, and choose the events to send.
3. Copy the signing secret (it starts with `whsec_`). It is shown once. Store it with your receiver.
4. Select Send test event. The card shows the result after a few seconds (delivered with the status code, or the reason it failed), and the delivery log lists it.

A community can have up to 20 endpoints.

## Change an endpoint

- **Edit** changes the URL, the description, and the events in place. The secret and the delivery log stay; deliveries still waiting go to the new URL.
- **Rotate secret** creates a new secret and shows it once. "Keep the old secret working for 24 hours" is on by default: for 24 hours every delivery carries two signatures in `webhook-signature`, one per secret, so the receiver keeps working until you store the new secret. The card says until when. Turn the option off when the old secret leaked; it then stops working at once. Through the API, `keepPrevious: true` on `rotate-secret` asks for the overlap and the default is no overlap.
- **Turn off** stops deliveries and marks waiting ones failed. **Turn on** offers to resend the deliveries that failed since the endpoint started failing or was turned off.

## Delivery log and resend

The log lists deliveries newest first with when, status, event, and result (answer or error, attempts, next try). On a phone each delivery is a stacked row. Times are in UTC.

**Details** opens one delivery: the payload, and for each attempt the time, the request headers and body, the response status, the first 2048 characters of the response body, the error, and how long it took. The signing secret is never shown; the signature headers are.

**Resend** sends the delivery again now with the same `webhook-id`, so a receiver that already processed it can drop it. A finished delivery starts a new retry schedule; one waiting for its next retry is sent now. The endpoint must be on. Through the API, `resend-failed` with a `since` time resends up to 500 failed deliveries at once.

## Events

| Event | When | `data` fields |
|---|---|---|
| `post.created` | A post is published (scheduled posts at publish time) | `communityId`, `postId`, `authorId`, `agentId` (null unless an agent wrote it) |
| `comment.created` | A comment or reply is added | `communityId`, `postId`, `commentId`, `parentId`, `authorId`, `agentId` (null unless an agent wrote it) |
| `member.joined` | A membership becomes active (join, approval, invite, payment; archive and member imports send nothing) | `communityId`, `userId`, `role` |
| `member.removed` | An active membership ends (left, removed, banned) | `communityId`, `userId`, `status`, `reason` (`left` when the member left or erased their account, `removed` when staff removed them or their paid access ended, `banned`; added in 0.9, events recorded earlier get `banned` or `removed` from their status) |
| `lesson.completed` | A member completes a lesson for the first time | `communityId`, `userId`, `courseId`, `lessonId` |
| `event.rsvp_changed` | A member answers or changes an RSVP | `communityId`, `userId`, `eventId`, `occurrenceId`, `status` |
| `subscription.activated` | A paid membership starts giving access | `communityId`, `userId`, `subscriptionId`, `planId` |
| `subscription.ended` | A paid membership stops giving access | `communityId`, `userId`, `subscriptionId`, `planId` |
| `review.created` | A member writes a review (Step 17) | `communityId`, `reviewId`, `authorId`, `rating` |
| `review.updated` | The author edits their review | `communityId`, `reviewId`, `authorId`, `rating` |
| `review.deleted` | The author deletes their review | `communityId`, `reviewId` |
| `review.hidden` | The owner hides a reported review | `communityId`, `reviewId`, `reason` (`spam`, `abuse`, `personal_data`, `off_topic`) |
| `webhook.test` | Send test event | `communityId`, `endpointId` |

Payloads carry ids and statuses only, never post text, email addresses, or payment method details. Fetch details through the REST API with your own token, so permission checks stay in one place.

Each request body looks like this:

```json
{
  "type": "post.created",
  "timestamp": "2026-10-19T10:00:00.000Z",
  "data": {
    "communityId": "0192f0a0-0000-7000-8000-00000000c001",
    "postId": "0192f0a0-0000-7000-8000-00000000a001",
    "authorId": "0192f0a0-0000-7000-8000-000000000001",
    "agentId": null
  }
}
```

## Headers and signature

Requests follow [Standard Webhooks](https://www.standardwebhooks.com/):

| Header | Value |
|---|---|
| `webhook-id` | Event id, the same on every retry. Deduplicate on it. |
| `webhook-timestamp` | Unix time in seconds when this attempt was signed |
| `webhook-signature` | `v1,` followed by the base64 HMAC SHA-256 of `{webhook-id}.{webhook-timestamp}.{body}`, keyed with the base64 decoded part of the secret after `whsec_`. During a secret roll it holds two signatures separated by a space; accept the request when any of them matches |

### Verify in Node.js

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyCohoryWebhook(secret, headers, rawBody) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"] ?? "";
  if (!id || !timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false;
  }
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(
    `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`,
  );
  return signatures.split(" ").some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

Sign the raw body exactly as received, before parsing JSON. Any Standard Webhooks library (for example the `standardwebhooks` package) accepts the same secret.

## Delivery and retries

- A delivery succeeds when the receiver answers with a 2xx status within 10 seconds. Redirects are not followed and count as failures.
- Failed deliveries are retried after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, 14 hours, 20 hours, and 20 hours: 10 attempts over just under 3 days.
- At most 4 deliveries per endpoint are in flight at once; the rest wait.
- When a delivery fails every attempt and the endpoint had no successful delivery since that event, the endpoint is turned off, waiting deliveries are dropped, and the owner gets an email when their address is confirmed. Turn it back on in Manage, Settings, Webhooks. Events from while it was off are not sent on their own; resend them from the prompt that appears after Turn on, or one by one from the delivery log.
- Each attempt is stored with its request and a response excerpt and is deleted with its delivery when the endpoint is deleted.
- Delivery is at least once and not in order. Use `webhook-id` to drop duplicates and fetch the current state through the API when order matters.

## Network rules for operators

Deliveries go through the egress helper (`@cohory/egress`). It refuses loopback, private, link local, carrier grade NAT, cloud metadata, multicast, and reserved addresses, checks every address a host name resolves to, and connects to the address it checked, so a DNS answer that changes between check and connect cannot reach an internal service.

| Variable | Purpose |
|---|---|
| `EGRESS_ALLOW_PRIVATE_HOSTS` | Comma separated host names or IP addresses exempt from the private address check, and allowed with plain http. Meant for tests and for a trusted receiver on your own network. Leave it empty on a public server. |
| `WEBHOOKS_ENCRYPTION_KEY` | Optional. 32 bytes, base64, that encrypt endpoint secrets at rest (AES-256-GCM). When unset, a key is derived from `BETTER_AUTH_SECRET`. |
| `WEBHOOKS_ENCRYPTION_KEYS` | Optional. A comma separated list of keys, current first, for rotation: the first seals new secrets, all of them (and the two above) open stored ones, and `pnpm secrets rotate` or the hourly `secrets.reencrypt` job moves stored secrets to the first key, including the old secret of a roll still in its 24 hour overlap. See [Rotating secrets](operator-guide.md#rotating-secrets). |

The worker runs three queues: `webhooks.fanout` (creates one delivery per endpoint and event from the outbox), `webhooks.deliver`, and `webhooks.sweep` (every minute, picks up deliveries that are due and not held by a job).
