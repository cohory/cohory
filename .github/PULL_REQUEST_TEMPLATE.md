## Summary

What this changes and why. Link the issue: Closes #

## Verification

Commands you ran and their results, screenshots for UI changes.

## Checklist

- [ ] The PR does one thing and the title follows Conventional Commits (`type(scope): summary`).
- [ ] Docs are updated in this PR (`docs/product` matches the UI, architecture docs match the code).
- [ ] A decision record is added or linked if this is an architectural change.
- [ ] Tests cover the change.
- [ ] If money, fees, auth, permissions, subscriptions, or entitlements are touched: tests for those paths are included, including denied and cross-tenant cases.
- [ ] Every new query on community data is scoped by `community_id`, and authorization is checked in the service.
- [ ] Migrations are forward-only, use expand and contract for breaking changes, and no merged migration was edited.
- [ ] No secrets, tokens, live payment keys, or real customer data in code, fixtures, logs, or screenshots.
- [ ] No planned feature is presented as available in UI or docs.
