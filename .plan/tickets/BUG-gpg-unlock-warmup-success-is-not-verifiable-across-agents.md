<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: gpg-unlock warmup success is not verifiable across agents

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** gpg
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** none

**Summary:**
User reports `giwt gpg-unlock` repeatedly prints a successful warmup line, yet running agents in a long session still encounter cold/unusable GPG caches. Review of `src/commands/gpg-unlock.ts` + `src/utils/gpg-cache.ts`: both success paths are honest only about the **current process** — `probeCachedPassphrase()` uses a cancel-mode trial sign, and `warmAgentCache()` re-probes after warming. Nothing verifies that another process/agent with a different environment sees the same agent cache.

Evidence collected 2026-11-18 in this shell: no `GIT_GPG_PASSPHRASE`, no `~/.gpg-passphrase`, non-TTY, `GNUPGHOME` unset; `giwt gpg-unlock` prints `Cache is warm; TTL re-armed via real sign.` and a direct probe reports warm with `keyinfo --list` cached=1. So the current command is not lying about the local probe; the gap is scope/observability and headless self-healing.

**Acceptance Criteria:**

- [x] Make the success line state exactly what was verified: key, effective agent socket/GNUPGHOME, TTL, and that verification is process-local.
- [x] Add a preflight self-heal in `assertGpgUnlocked()` via `warmAgentCache()` when a headless passphrase source exists; keep the no-TTY/no-source refusal honest.
- [x] Add tests proving the warm path reports the agent identity and that the cold path attempts headless warm before failing.
- [x] Document the hard limit: no code can warm a cache living in a different gpg-agent (different GNUPGHOME); that requires environment alignment.

**Context:**
The gpg-agent passphrase cache is per agent socket; `GNUPGHOME` selects that socket (verified: `GNUPGHOME=/tmp/x gpgconf --list-dirs agent-socket` yields a different path). No giwt code changes `GNUPGHOME`; agents with a different value cannot be warmed by another process. Never write the passphrase to logs or disk, and never prompt outside a TTY.
