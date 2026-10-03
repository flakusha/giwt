<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: ledger schema v2 writer

**Status:** Done
**Priority:** high
**Effort:** Small
**Epic:** ledger-redesign
**Tags:** ledger, schema-v2

**Summary:**

`appendLedger` builds `LedgerRecordV2` via `newRecord` (seq = last + 1, state in-progress); `finishRecord` generalizes `enrichOwnRecord`; `readLedger` normalizes v1+v2. Phase 1 writer of ledger-redesign.md §§2.1-2.4 + §5 — blocked on FEAT-ledger-core-canonical-module (Phase 0).

**Context:**

Source of truth: ledger-redesign.md §2.2 (v2 schema: state/agent/seq/error), §2.3 (exact writer signatures), §2.4 (minimal writer changes), §5 (Phase 1 safe only because Phase-0 readers already normalize both). The record carries NO repo key (single-repo scope; no cli basename argument). Backfill skipped per §5 Phase 2 YAGNI — mixed v1+v2 files are valid. Rollback: revert writer to v1 while keeping Phase-0 readers.

**Acceptance Criteria:**

- [ ] `appendLedger` builds via `newRecord`: seq = last + 1 (v1 lines normalize to seq 0, so first v2 line is seq 1), state "in-progress", agent filled from `$GIWT_AGENT ?? hostname:pid`
- [ ] `finishRecord(treeDir, cmd, outcome: LedgerOutcome)` generalizes `enrichOwnRecord` (same pid+cmd match; writes state finished/postponed + error object + human text); `appendCommitOutcome`/`appendGripe` become thin wrappers, call sites untouched
- [ ] No cli basename argument; NO repo key on the record
- [ ] `readLedger` normalizes v1+v2 via `normalizeRecord`; keeps existsSync early return + best-effort try/catch
- [ ] Phase-0-before-Phase-1 gate: MUST NOT land before FEAT-ledger-core-canonical-module
