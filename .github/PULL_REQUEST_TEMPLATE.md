## Summary

What this changes and why. Closes #

## Verification

Commands you ran and their results. Screenshots for UI changes.

## Checklist

- [ ] The PR does one thing, links its issue, and the title follows Conventional Commits (`type(scope): summary`).
- [ ] Docs are updated in this PR (`docs/product` matches the UI, architecture docs match the code). An architectural change adds or links a decision record.
- [ ] Tests cover the change. Changes to money, auth, permissions, subscriptions, or entitlements include tests with denied and cross-tenant cases.
- [ ] Every new query on community data is scoped by `community_id`, and authorization is checked in the service.
- [ ] Migrations are forward-only, use expand and contract for breaking changes, and no merged migration was edited.
- [ ] No secrets, tokens, live payment keys, or real customer data in code, fixtures, logs, or screenshots.
- [ ] No planned feature is presented as available in UI or docs.
