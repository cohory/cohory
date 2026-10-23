# 0045. Levels that unlock courses, and points for learning

Creators can lock a course until a member reaches a level. Points for finished lessons and attended events are built but off in every community: no creator can turn them on until the switch is added to Manage, Settings (see Consequences). The leaderboard shows the level ladder and how points are earned.

- ADR status: Accepted
- Date: 2026-10-22
- Deciders: founder (approved review 12 items, 2026-10-22), coordinator as product owner for the details below
- Related: [../product/mvp-scope.md](../product/mvp-scope.md) section 2.7, [0031](0031-community-access-module.md), [../architecture/data-model.md](../architecture/data-model.md) section 14.2

## Context

Points came only from likes and unlocked nothing, so levels meant little to members who learn quietly (review of 2026-10-21). Unlocking a course by level is the best known engagement loop on comparable platforms. The schema for it landed in migration 0035: `courses.required_level` (1 to 9 or null), `communities.points_for_lessons` and `points_for_events` (default off), the ledger reasons `lesson_completed` and `event_attended`, and the source types `lesson` and `event_occurrence` with a unique index per member and source.

## Decision

1. **Who passes a lock.** `levelUnlocked` in `@cohory/entitlements/access` answers it: no required level opens to everyone; moderators, admins and the owner always pass; a member passes at or above the level; someone who is not a member never passes. `memberLevelIn` reads the member's level in the current community only. Content modules ask these functions and never read `member_stats` themselves.
2. **What a lock hides.** The courses service enforces it. A member below the level sees the course card and the course title, description and required level, with no lessons. Lessons, lesson progress, attachments, lesson search hits, Continue learning and agent material of a locked course answer as not found. A lock is ignored while levels are turned off for the community, and the course settings only offer it while they are on.
3. **Setting the level.** Only people who may update the course (owner and admins) set `requiredLevel`, through the same course update permission.
4. **Learning points.** One point per finished lesson and per attended event, each counted once per member and source. They are awarded only to members whose membership is active when the job runs (a banned, removed, or pending member gets nothing), only while levels are on and the matching setting is on, and learning from before a points reset is skipped. A point already given stays when the lesson is marked unfinished, and finishing it again adds nothing.
5. **What counts as attending.** There is no attendance record, so a "going" RSVP on an occurrence that has ended and was not cancelled counts. A deleted event leaves no occurrences, so it awards nothing. A moved event keeps its RSVPs (calendar keeps them on a time change).
6. **How points are awarded.** A cross-module side effect goes through a job (AGENTS.md section 2). The worker job `gamification.learning-points` runs every 15 minutes with one active run, reads lessons finished and events attended in the last two days through `lessonCompletionsBetween` (courses) and `attendedOccurrencesBetween` (calendar), and records them with `recordLearningActivities` (gamification), which checks the settings. Overlapping windows add nothing because of the ledger's unique index. Turning a setting on also counts the last two days.
7. **Imports.** An archive import maps `lesson` and `event_occurrence` ledger sources to the imported lesson and occurrence ids, so the job does not award them again.
8. **Leaderboard.** It shows the viewer's progress to the next level from all time points, the line "You earn 1 point for each like on your posts and comments", extended with lessons and events when they are on, and the nine levels with their names, starting points and the share of active members at each.

## Alternatives considered

| Option | Pros | Cons | Why not chosen |
|---|---|---|---|
| Award lesson points in the same transaction as the completion | Points appear at once | Couples courses to gamification, against the boundary rules | A job keeps the modules apart; 15 minutes is acceptable |
| A domain event per lesson completion through the outbox | Immediate and decoupled | New topic, publisher and route for one point; attendance still needs a timed scan | One sweep covers both sources |
| Lock individual lessons | Finer control | More UI and more checks for a rare need | Course level locks cover the review item |
| Hide locked courses entirely | Simpler | Members do not see what they are working towards | Seeing the goal is the point of the feature |

## Consequences

- Points for learning are off in every community. The switches default to off and there is no way to change them yet; they will be added to Manage, Settings next to "Show points and levels" in a later change. Until then the leaderboard earning line mentions likes only.
- The REST API reads and sets the lock through the courses service: course create and update accept `requiredLevel`, and course responses carry `requiredLevel` and `locked`. MCP tools respect the lock but do not show these fields yet.
- Archive export does not include `required_level` or the learning points switches yet; a later change adds them.
- Points for lessons can reach a member a few minutes after they finish.
