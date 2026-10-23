# Design red flags

Screen every candidate before picking. A red flag is a reason to revise or reject the shape.

## Shallow module

A large interface that hides little. Signs: callers coordinate several methods to finish one operation, public options expose internal stages, learning the interface does not save the caller from learning the implementation. Do not confuse a deep module with a deep call chain.

## Information leakage

Several modules depend on the same internal decision, so changing it needs coordinated edits. Re-exporting Drizzle rows, Stripe objects, or request types through a package API is leakage.

## Temporal decomposition

Modules organized by execution order (load, validate, transform, save) instead of by the knowledge they own. They repeat one representation and its invariants across stages.

## Pass-through method

A method that forwards the same arguments to another method with the same shape. Remove it unless it adds policy or a distinct abstraction.

## Split ownership

More than one module writes the same state or keeps its own copy. An agent that edits one writer cannot see the others. Give each piece of state one owner.

## Two ways to do one task

An agent copies whichever way it finds first, so both keep gaining callers. Keep one way and delete the other in the same change.

## Importable internals

A caller can import a package's internals, so they become the interface. Use the `exports` field in each package's `package.json` so an import from outside fails the build.

## Hand-synced list

Two places list the same items (permissions, plan tiers, notification types). Keep one list and derive the others, or make the build fail when they disagree.

## Missing tenant scope

A query or cache key that does not include the community id where data is per-community. Cohory is multi-tenant. Treat a missing scope as a security bug, not a style issue.
