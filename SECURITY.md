# Security policy

How to report a vulnerability in Cohory privately, what we consider in scope, and how we respond.

This policy applies to the latest release and to anything in this repository. The internal threat model and review live in [docs/security](docs/security/threat-model.md); an external review is pending (see [review-2026-10](docs/security/review-2026-10.md) section 5).

## Supported versions

Only the latest minor release receives security fixes before 1.0 (see [release-strategy](docs/open-source/release-strategy.md)).

| Version | Supported |
|---------|-----------|
| Latest minor (0.x) | Yes, latest patch |
| Earlier minors | No |

**Recommendation:** after 1.0, the latest minor of the current major and of the previous major for six months.

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a security problem.

Report it through GitHub private vulnerability reporting: open [Report a vulnerability](https://github.com/cohory/cohory/security/advisories/new) in the repository's **Security** tab. If you cannot use GitHub, email [hello@cohory.org](mailto:hello@cohory.org) with "Security" in the subject and no exploit details; we reply with a private channel.

To reach the operator of a particular Cohory server, use the contact in its `/.well-known/security.txt`. Every server publishes that file (RFC 9116) once its operator sets `SECURITY_CONTACT` or `CONTACT_EMAIL` ([self-hosting](docs/self-hosting.md#legal-pages-and-contact)).

For a self-hosted server, the operator who runs it handles reports about their configuration and data. Report problems in the code itself here.

Please include:

- What is affected (version, commit, or deployment type: self-hosted or Cloud)
- Steps to reproduce, or a proof of concept
- The impact you expect (for example, a member of one community reading another community's data)
- Whether you have shared the issue with anyone else

## Response targets

**Recommendation.** These are targets, not guarantees, while the maintainer team is small.

| Step | Target |
|------|--------|
| Acknowledge the report | 3 working days |
| Initial assessment and severity | 7 working days |
| Fix for critical or high severity | 30 days, faster when actively exploited |
| Fix for medium or low severity | Next scheduled release |
| Public advisory | When a fix is released, coordinated with the reporter |

We will keep you informed and credit you in the advisory unless you prefer otherwise.

## Severity

Issues in these areas are treated as highest severity by default:

- **Tenant isolation.** Any way to read or change data of a community you do not belong to, or to act with a role you do not hold.
- **Payments.** Any way to change prices, fees, payouts, refunds, or subscription state without authorization; to bypass entitlements to paid content; to forge webhook events; or to expose payment account credentials.
- **Authentication.** Account takeover, session fixation, or bypassing sign in.
- **Agent permissions.** Any way for an agent or API key to exceed its granted scopes.

Other issues are rated with CVSS as a guide.

## Scope

In scope:

- Code in this repository, including the Docker Compose setup and default configuration
- The Cloud Edition, once it exists, within the rules below

Out of scope:

- Vulnerabilities in third-party services (Stripe, email providers, hosting) that are not caused by how Cohory uses them. Report those to the vendor.
- Self-hosted deployments that changed security-relevant defaults
- Denial of service through volume, spam, or social engineering
- Missing security headers or best practices without a demonstrated impact

## Disclosure

- Fixes are prepared in a private fork or a GitHub security advisory, never on a public branch.
- A security release ships as a patch on every supported line with release notes under "Security" and an advisory that names the affected versions, how to tell whether an instance was exposed, and how to upgrade.
- We ask reporters to hold publication until the fix is released, up to 90 days after the report. If a fix cannot ship in that time we agree a new date with the reporter.
- Reporters are credited in the advisory unless they prefer not to be.

## Safe harbor

We will not pursue legal action against good faith research that:

- Uses only test accounts and test communities you own, and Stripe test mode
- Does not access, change, or keep data belonging to other people beyond what is needed to show the issue
- Does not degrade service for others
- Gives us reasonable time to fix the issue before disclosure

If you are unsure whether something is allowed, ask first through the private report.

## Decisions and open questions

- **Recommendation:** GitHub private vulnerability reporting as the main channel, response targets above, supported version policy.
- **Confirmed** (decision [0039](docs/decisions/0039-legal-pages-and-data-rights.md)): every server serves `/.well-known/security.txt` from `SECURITY_CONTACT`, falling back to `CONTACT_EMAIL`.
- **Open question:** the project's security contact email and whether to publish a PGP key.
- **Open question:** whether to run a paid bug bounty after the Cloud Edition launches.
