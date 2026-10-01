<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# INFRA: dispose two stale loop lore worktrees

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Tags:** worktrees

**Summary:**

Target: loop-lore. Two worktrees were left unmerged by earlier agents and need an explicit disposition; both hold work that dev does not have.

fix-asset-dedup-race (8 commits, HEAD 5e7a8b66b): src/assets/service/create.ts + tests + migration 028_assets_content_hash_unique. dev already carries migration 029_assets_dedup_owner_encryption_key_unique from a different branch, so 028 numbering collides, and the branch create.ts work overlaps dev ac05befd3 feat(assets) let edits spawn a new item instead of deduping. This branch is the only implementation of BUG-asset-dedup-ignores-requested-encryption-tier-and-key-return.

fix-async-store-offload-dir (4 commits, HEAD 383a9318d): src/async/* offload-dir work. dev already carries the same fix by another path (79f2ecc21 and neighbours), so the branch is redundant.

Acceptance: each branch is either merged with a renumbered migration or explicitly abandoned, with the loop-lore tickets updated to match. No unmerged worktree may hold the only copy of an open ticket fix.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
