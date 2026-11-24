<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: gpg warmup cannot outlive max-cache-ttl despite success report

**Status:** Done (fixed 2026-11-24: hermetic per-test max-cache-ttl regression in `src/commands/gpg-unlock.test.ts`; TTL cap semantics documented in `src/utils/gpg-cache.ts`; durable setup documented in `AGENTS.md`)
**Priority:** medium
**Effort:** Small
**Tags:** gpg
**Caveats:** TTL, security, environment, observability
**Related:** BUG-gpg-unlock-warmup-success-is-not-verifiable-across-agents (Done), FEAT-export-a-reusable-cold-cache-gpg-warm-helper-so-consumers-st.md

**Summary:**
`giwt gpg-unlock` reports success after verifying a warm cache and re-arming
the TTL with a real sign, but gpg-agent `max-cache-ttl` is an absolute cap:
after it elapses the passphrase is gone and a manual unlock is required.
No amount of re-signing can extend it. The earlier ticket fixed scope and
observability; it did not address this expiry, which is the user-visible
complaint: reports success, then manual unlock after the warm time.

**Evidence (2026-11-24, gpg 2.5.24):**

- Temp agent `default-cache-ttl 6` / `max-cache-ttl 24`, real sign every 4s:
  signs succeeded at t=4/8/12/16/20, failed at t=24/28/32 and stayed cold.
  `max-cache-ttl` counts from the original cache insertion, not from the last
  sign. A cancel-mode probe afterwards is cold, so this is not a phantom cache.
- This shell: no `GIT_GPG_PASSPHRASE`, no `~/.gpg-passphrase`, non-TTY,
  `GNUPGHOME` unset, configured TTL 28800s. After expiry, `warmAgentCache()`
  returns `via: "none"`; `assertGpgUnlocked()` cannot self-heal, so manual
  unlock is the only source. All five signing call sites already route
  through that preflight.

git issue: cf36a47

- Raw `PRESET_PASSPHRASE <grip> <ttl> <hex>` still returns
  `ERR 67108933 Not implemented`. `/usr/libexec/gpg-preset-passphrase
  --preset <grip>` does warm the cache when `allow-preset-passphrase` is set,
  but a wrong passphrase makes it exit 0 with empty output while leaving the
  cache cold, and the entry is still TTL-bound. Not a durability fix.

**Already addressed (messaging patch, 2026-11-24):**
Success lines now print `GNUPGHOME`, the capped TTL, and an explicit note
that post-expiry headless re-warm needs `GIT_GPG_PASSPHRASE` or
`~/.gpg-passphrase`; otherwise manual unlock is required.

**Acceptance Criteria:**

- [x] Add a hermetic regression test showing that repeated real signs fail
      once `max-cache-ttl` elapses (tiny TTLs, deterministic, no long sleeps).
      Resource contract: each test owns its own `mkdtempSync(scratchRoot())`
      GNUPGHOME/HOME and key uid; agent and dirs released in `finally`.
      No shared globals or fixed paths — order-independent under parallel run.
- [x] Document in `src/utils/gpg-cache.ts` that `default-cache-ttl` is
      re-armable while `max-cache-ttl` is absolute, and that
      `effectiveCacheTtl()` reports the cap rather than a renewable lease.
- [x] Record the recommended durable setup (headless passphrase source, or
      raise both TTLs) in user-facing docs; clarify that a keepalive daemon
      cannot beat `max-cache-ttl`.
- [x] If preset is ever adopted, validate with a probe: its exit code is 0
      even on a wrong passphrase.

**Context:**
This is a hard gpg-agent limit, not a giwt defect. The correct product
behavior is honest reporting plus per-use self-heal from a passphrase source.
Never write the passphrase to logs or disk; never prompt outside a TTY.
