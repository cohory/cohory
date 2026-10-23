# Session handling in apps/web

Protect a server layout or page with `const session = await requireSession("/c/my-slug");` from `@cohory/auth/next`. It returns the session or redirects to `/sign-in?next=...`.
Read the session without redirecting (for optional UI such as an avatar menu) with `await getSession()` from `@cohory/auth/next`. Calls are deduplicated per request.
Sign out from a form or button with `<form action={signOut}>`, importing `signOut` from `apps/web/lib/auth/actions.ts`.
Client components call Better Auth through `authClient` from `@cohory/auth/client`. Never import `@cohory/auth` itself into client code, because it loads the database client.
The session only proves who the person is. Every service call still checks permissions through the policy module.
