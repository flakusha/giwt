<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: ledger-core canonical module

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Epic:** ledger-redesign
**Tags:** ledger, shared-module

**Summary:**

New giwt-internal `giwt/src/utils/ledger-core.ts`: pure dependency-free canonical module (types/constants/`normalizeRecord`/`parseLedgerTail`/`formatRecord`/`newRecord`, no fs/process/imports). Reader-first Phase 0 of ledger-redesign.md §§2.1-2.4 reader/writer mechanics + §5 Phase 0.

**Context:**

Scope is the single-repo subset of ledger-redesign.md: §§2.1-2.4 (record shape, reader/writer mechanics) plus §5 Phase 0 (readers first). §§2.5-2.6 (multi-repo coordination) are explicitly out of scope — coordination lives inside this repo only, and upstream filing is already covered by `giwt ticket`. No `[ledger]` section exists in settings-schema.ts, so no config surface is added here. Every reader today rejects v2 records, so the canonical reader module must land before any writer change. Pairs with FEAT-ledger-schema-v2-writer (Phase 1 writer; blocked on this ticket).

**Acceptance Criteria:**

- [ ] `ledger-core.ts` exports `LEDGER_SCHEMA_VERSION`, `LEDGER_FILENAME`, `LEDGER_MAX_RECORDS`, `LEDGER_MAX_MSG`, `LedgerState`/`LedgerReadState`/`LedgerError`/`LedgerRecordV2`/`LedgerRecordAny`/`LedgerRecord`, `normalizeRecord` (v2 as-is; v1 → v2 with state "observed", agent `pid:<pid>`, seq 0, NO repo key; garbage → null), `parseLedgerTail` (offset = start of first incomplete trailing line), `formatRecord`, `newRecord`
- [ ] `ledger-core.ts` has no fs/process/imports (pure)
- [ ] `readLedger` uses `normalizeRecord` (v1 output byte-identical); writer still emits v1
- [ ] Phase-0-before-Phase-1 gate: FEAT-ledger-schema-v2-writer MUST NOT land before this ticket
