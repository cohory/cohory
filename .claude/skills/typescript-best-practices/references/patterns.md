# TypeScript patterns

Examples for each rule in `../SKILL.md`.

## Branded ids

```ts
type CommunityId = string & { readonly __brand: "CommunityId" };

const communityIdSchema = z.string().uuid().transform((v) => v as CommunityId);

function parseCommunityId(input: unknown): CommunityId {
	return communityIdSchema.parse(input);
}
```

The single `as` lives inside the schema transform, after validation. Everything downstream trusts the brand.

## Discriminated unions

```ts
// Don't. Contradictory states are representable.
type CheckoutState = { loading: boolean; url?: string; error?: string };

// Do. Only valid states exist.
type CheckoutState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "ready"; url: string }
	| { kind: "error"; message: string };
```

Pick one discriminant name (`kind`) and use it everywhere.

## Membership status as a domain type

```ts
type Membership =
	| { kind: "free"; joinedAt: Date }
	| { kind: "trialing"; trialEndsAt: Date; priceId: string }
	| { kind: "active"; renewsAt: Date; priceId: string }
	| { kind: "past_due"; graceEndsAt: Date; priceId: string }
	| { kind: "canceled"; accessEndsAt: Date };

function canViewPaidContent(m: Membership, now: Date): boolean {
	switch (m.kind) {
		case "free":
			return false;
		case "trialing":
		case "active":
			return true;
		case "past_due":
			return now < m.graceEndsAt;
		case "canceled":
			return now < m.accessEndsAt;
		default: {
			const _exhaustive: never = m;
			return _exhaustive;
		}
	}
}
```

Adding a variant now fails the build at every switch that forgot it.

## Constructive modeling

```ts
type NonEmpty<T> = [T, ...T[]];

const isNonEmpty = <T>(arr: T[]): arr is NonEmpty<T> => arr.length > 0;

function firstLesson(lessons: NonEmpty<Lesson>): Lesson {
	return lessons[0];
}
```

Time range as start plus duration so a negative range cannot be written:

```ts
type EventSlot = { startsAt: Date; durationMinutes: number };
```

## Schemas at the boundary

```ts
const createPostInput = z.object({
	communityId: communityIdSchema,
	title: z.string().trim().min(1).max(200),
	body: z.string().max(20_000),
});

type CreatePostInput = z.infer<typeof createPostInput>;

export async function createPost(raw: unknown) {
	"use server";
	const input = createPostInput.parse(raw);
	const session = await requireSession();
	await requireRole({ userId: session.userId, communityId: input.communityId, role: "member" });
	return posts.create({ authorId: session.userId, ...input });
}
```

Use `safeParse` when a failure is an expected branch, such as form validation that returns field errors.

## Derive row types from Drizzle

```ts
import { posts } from "@cohory/database/schema";

type Post = typeof posts.$inferSelect;
type NewPost = typeof posts.$inferInsert;

function renderPostCard(post: Pick<Post, "id" | "title" | "createdAt">) {
	/* ... */
}
```

## Webhook parsing

```ts
export async function POST(req: Request) {
	const signature = req.headers.get("stripe-signature");
	if (!signature) return new Response("missing signature", { status: 400 });
	const event = stripe.webhooks.constructEvent(await req.text(), signature, env.STRIPE_WEBHOOK_SECRET);
	await handleStripeEvent(event); // idempotent, keyed by event.id
	return new Response(null, { status: 200 });
}
```

## `satisfies` over `as`

```ts
const levelThresholds = [
	{ level: 1, points: 0 },
	{ level: 2, points: 5 },
	{ level: 3, points: 20 },
] as const satisfies ReadonlyArray<{ level: number; points: number }>;
```

## Object args

```ts
// Don't. Swapping the two ids still compiles.
grantPoints(userId, communityId, 5);

// Do.
grantPoints({ userId, communityId, points: 5 });
```

## Removing an existing `as`

Find why TypeScript cannot infer:

- Missing discriminant. Add one.
- Source type too wide (`Record<string, unknown>`). Narrow it at the boundary.
- Untyped boundary. Parse with the zod schema that owns the shape.
- Genuinely inexpressible. Use a brand or `satisfies`.
