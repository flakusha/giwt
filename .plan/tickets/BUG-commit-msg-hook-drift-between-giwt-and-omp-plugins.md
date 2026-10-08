<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: commit-msg hook drift between giwt and omp-plugins

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** drift, hooks

**Summary:**

giwt's .githooks/commit-msg and omp-plugins' .githooks/commit-msg differ in comment header, message prefix (`giwt commit-msg:` vs `commit-msg:`), and temp filename suffix (.giwt-trailer-clean vs .trailer-clean). The identity logic (identity_check_commit pre-check, identity_check_trailer per kept trailer, consent precedence) is identical. The drift tests in generators.test.ts only pin identity-gate.sh/gate-env.sh, so this cosmetic drift is uncovered. The omp-plugins commit-msg header claims "three must not drift" — currently false for commit-msg.

**Context:**

The commit-msg hook exists in both giwt and omp-plugins repos. While the core identity-check logic is identical, cosmetic differences have crept in:

- Comment header text differs
- Message prefix differs (`giwt commit-msg:` vs `commit-msg:`)
- Temp filename suffix differs (.giwt-trailer-clean vs .trailer-clean)

The drift test suite (generators.test.ts) only covers identity-gate.sh and gate-env.sh, leaving commit-msg drift undetected.

**Acceptance Criteria:**

- [x] Reconcile the two copies (same prefix, same temp suffix, same header claim)
- [x] Extend the drift tests to cover commit-msg byte-identity (or document intentional divergence)
- [x] Both repos' commit-msg hooks are byte-identical after reconciliation
**Resolved:** 2026-10-08T10:14:13.400Z Fixed by 5ea9321 (giwt, canonicalized on omp-plugins copy) + f9a5501 (omp-plugins drift pin). Hooks byte-identical (sha1 69855ecc…); drift now test-pinned.
