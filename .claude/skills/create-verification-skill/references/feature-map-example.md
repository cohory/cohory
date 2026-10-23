# Feature map example

The feature map lives in `.claude/skills/verify-cohory/features/`. `README.md` indexes one file per user-facing feature. Every feature file uses the same four sections.

## README.md

```markdown
# Feature map

One file per user-facing feature. Each says how to reach it as a user, how to drive it, and what end state proves it works.

| Feature | File | Roles needed |
|---------|------|--------------|
| Sign up and sign in | auth.md | none |
| Create a post | create-post.md | member |
| Join a paid community | paid-join.md | non-member, Stripe test mode |
```

## create-post.md

```markdown
# Create a post

A member publishes a post to a community feed. Other members see it at the top of the feed.

## Sub-features

- Title and body with markdown.
- Category selection.
- Image attachment (S3-compatible storage).

## How to get to it (user POV)

Sign in as `member@seed.local`. Open `/c/demo`. Click the "Write something" box at the top of the feed.

## Driving it with the browser

1. Go to `http://localhost:3000/c/demo`.
2. Click the textbox with accessible name "Write something".
3. Fill "Title" and "Body". Click the button named "Post".
4. Wait for the post card with the same title to appear first in the feed.

Proof: screenshot of the feed with the new card, plus `select id, title from posts where title = '<title>'` returning one row with the right `community_id`.

## Gotchas

- The composer is disabled for members whose subscription is `past_due`. Use the seeded active member.
- Image upload needs the MinIO service from Docker Compose. Without it, the post saves but the image fails silently in dev.
```
