# Governance

How decisions are made in Cohory, who maintains it, and how that will change as the project grows.

Everything in this document is a **Recommendation** for the early project and will be revisited when there are regular outside contributors.

## Current model: lead maintainer

The project starts with a lead maintainer model (often called BDFL). The founder is the lead maintainer and has final say on:

- Product scope and the roadmap
- Accepting or rejecting decision records
- The license and any change to it
- Adding and removing maintainers
- Releases until a release manager rotation exists

The lead maintainer is expected to explain decisions in writing, usually in a decision record or the pull request that carries the change.

## Roles

| Role | Who | Can do |
|------|-----|--------|
| Contributor | Anyone who opens an issue, discussion, or PR | Propose changes, review, comment |
| Maintainer | Contributors invited by the lead maintainer | Review and merge PRs, triage issues, propose releases |
| Core team (planned) | Maintainers elected by the core team | Shared ownership of decisions described below |
| Lead maintainer | The founder | Final decision, see above |

## How decisions are made

1. Most changes are decided in the pull request by maintainer review.
2. Architectural, data model, payment, authorization, security, and license decisions need a decision record in [docs/decisions](docs/decisions/README.md). The record starts as Proposed, collects discussion for at least five working days (shorter for urgent security fixes), and is then Accepted or Rejected by the lead maintainer.
3. Accepted records are not edited. A later change supersedes them with a new record.
4. Decisions that override a [principle](docs/foundation/principles.md) must say so explicitly in the record.

## Adding maintainers

A contributor can be invited as a maintainer after sustained, high-quality contributions (code, review, docs, or triage) over several months, and a demonstrated understanding of the principles, tenant isolation, and payment safety rules in [AGENTS.md](AGENTS.md). The lead maintainer proposes the invitation; existing maintainers can object within one week. Maintainers who are inactive for six months move to emeritus status and can return by asking.

## Release manager rotation

Once there are at least three maintainers, the release manager role rotates per minor release. The release manager cuts release candidates, checks the changelog, coordinates security fixes, and publishes the release following [release-strategy](docs/open-source/release-strategy.md). Until then, the lead maintainer manages releases.

## Path to a core team

When the project has at least three active maintainers who are not employed by the same company as the lead maintainer, a core team forms:

- The core team accepts decision records by consensus, falling back to a majority vote.
- The lead maintainer keeps a veto on license, trademark, and Cloud business matters.
- New core team members are elected by the existing core team.

This step will be recorded as its own decision record.

## Conduct and conflicts

Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers with a conflict of interest in a decision (for example, a commercial relationship) disclose it and step back from that decision.

## Cloud Edition and the open-source core

The Cloud Edition runs the same core as the self-hosted Community Edition. Governance of the core does not depend on Cloud commercial interests, and Cloud needs must not block self-hosting the core ([principle 9](docs/foundation/principles.md)).

## Decisions and open questions

- **Recommendation:** lead maintainer model now, core team at three independent maintainers, rotating release manager, decisions through records.
- **Open question:** whether the project should move to a foundation or neutral home later.
- **Open question:** trademark policy for the name Cohory.
