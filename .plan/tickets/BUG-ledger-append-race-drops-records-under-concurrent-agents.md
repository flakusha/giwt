<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: ledger append race drops records under concurrent agents

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** ledger, concurrency

**Summary:**

`appendLedger` (`src/utils/ledger.ts:152-157`) is an unprotected read-modify-write with no file locking. Two concurrent runs read the same N lines, each pushes its record, each writes back N+1 — the first writer's entry is silently lost. `enrichOwnRecord` (`:233-251`) shares the same TOCTOU.

**Context:**

```ts
// src/utils/ledger.ts:152-157
const lines = existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0)
  : [];
lines.push(JSON.stringify(record));
writeFileSync(path, `${lines.slice(-LEDGER_MAX_RECORDS).join("\n")}\n`);
```

No flock/lock/rename/atomic anywhere in `ledger.ts` (verified by grep). Finalize serializes through its lockfile+queue, but every other command appends unguarded, and multi-agent flows routinely run concurrent trees against one shared `treeDir/.ledger.jsonl`.

Repro sketch: two parallel CLI invocations sharing a treeDir → `.ledger.jsonl` holds one record instead of two.

**Acceptance Criteria:**

- [ ] Concurrent appends never lose records (atomic append or temp-file + rename; `LEDGER_MAX_RECORDS` prune preserved)
- [ ] `enrichOwnRecord` cannot clobber a concurrent append
- [ ] Regression test drives concurrent appends and asserts both records land

git issue: afe3bf9
