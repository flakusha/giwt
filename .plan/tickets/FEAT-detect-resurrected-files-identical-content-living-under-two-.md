<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: detect resurrected files: identical content living under two paths after a rename

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** git, migrations

**Summary:**

A second-order consequence of the rename-defeated dedup defect, but a distinct detector with a distinct and much louder failure mode. Worth landing independently.

When a rename commit retires `A` in favour of `B`, any later commit that re-adds `A` leaves the tree holding two paths with identical content. In the numbered-migrations case this is catastrophic and silent at commit time:

- `040_messages_idempotency_unique.ts` and `045_messages_idempotency_unique.ts` coexisted, byte-identical apart from the migration name embedded in the docblock and a warning string
- both were discovered by `getMigrationFiles()`, so both ran
- the second `CREATE UNIQUE INDEX` raised `index already exists` and took down every test that builds a DB

Nothing at commit time objects. Typecheck is clean, lint is clean, the rebase reports success. The failure only appears at runtime, and it appears as a wall of unrelated-looking failures pointing at a single root cause.

Two checks worth implementing:

1. Number collisions in an ordered, filename-sorted directory (migrations, numbered stages, versioned schemas). Two files claiming the same leading number is a defect regardless of content.
2. Content twins: two tracked paths whose blobs differ only in an embedded identifier (the migration name, a version string, a module path). Flag the pair and name both paths.

Both are cheap, both are check-shaped rather than rebase-shaped, and both generalise past migrations to any numbered or versioned artifact directory.

Suggested surface: reuse the audit umbrella, reported as a distinct reason alongside duplicates and empties, and additionally runnable standalone so a repo can gate it in `bun run check` without the whole history audit.

Acceptance:

- detects duplicate leading numbers in a filename-ordered directory
- detects content-identical-twins that differ only in an embedded identifier, and names both paths
- flags both in the loop-lore migration directory as it stood before the fix
- each finding carries the two paths and enough evidence to accept or reject by hand

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T08:47:55.619Z Merged feat/audit-detectors (83bb11d) + wiring (2c8d0a0). Standalone gate: giwt history resurrected dir...
