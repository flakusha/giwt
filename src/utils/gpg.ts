// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * GPG pre-flight helpers for worktree signing flows.
 *
 * Centralizes the cold-cache detection that was previously inlined in
 * commit.ts, commit-wt.ts, sign.ts, merge.ts, and finalize.ts. Each
 * flow used a slightly different inline check; some emitted the
 * `Run: giwt gpg-unlock` hint on failure, others did not, and
 * two of them (`merge.ts` and `finalize.ts`'s direct branch via
 * `gpgMergeFlags`) silently degraded to unsigned commits when the cache
 * was cold.
 *
 * Usage:
 *   import { assertGpgUnlocked, assertAgentGpgUnlocked } from "../utils/gpg";
 *
 *   // For flows with an explicit key id (sign.ts, commit.ts, commit-wt.ts):
 *   assertGpgUnlocked(config.agentGpgKeyId);
 *
 *   // For flows that derive the key from .credentials.env (merge.ts,
 *   // finalize.ts): `assertAgentGpgUnlocked()` reads AGENT_GPG_KEY_ID
 *   // automatically.
 *   assertAgentGpgUnlocked();
 *
 * Failure modes — all exit 1, each emits a `hint: <mode>` stderr line so a
 * future programmatic consumer can branch on the hint without an exit-code
 * taxonomy today:
 *
 *   hint: invalid-key
 *     keyId is missing or not a valid hex fingerprint (8/16/40 chars).
 *
 *   hint: key-not-in-keyring
 *     `gpg --list-keys <id>` (public) or `gpg --list-secret-keys <id>`
 *     (secret) failed; the key material is not in the local keyring.
 *     Fix: `gpg --import <path-to-secret.asc>` or update
 *     `AGENT_GPG_KEY_ID` in `.credentials.env`.
 *
 *   hint: key-not-unlocked
 *     A silent trial sign (`--pinentry-mode cancel`) against gpg-agent
 *     failed: the agent has no usable cached passphrase (cache cold or
 *     stale). Fix: `giwt gpg-unlock` in a terminal.
 *
 * Design: tree/worktree-investigate-gpg-unlock-ergonomics/.tmp/gpg-unlock-ergonomics-design.md
 * Ticket: BUG-fix-worktree-assert-gpg-unlocked-on-every-signing-path-surfa
 */

import { spawnSync } from "bun";
import { probeCachedPassphrase } from "../gpg-unlock";
import { credentials } from "./credentials";
import { log } from "./output";

type GpgHint = "invalid-key" | "key-not-in-keyring" | "key-not-unlocked";

/**
 * Regex + length check for a GPG fingerprint.
 * Accepts full 40-char fingerprints, 16-char short IDs, and 8-char short
 * IDs. Must be hex.
 */
const FINGERPRINT_RE = /^[A-F0-9]+$/i;
const MIN_LEN = 8;
const MAX_LEN = 40;

function fail(hint: GpgHint, message: string): never {
  log("error", String(`hint: ${hint}`).replace(/\n$/, ""));
  log("error", String(message).replace(/\n$/, ""));
  process.exit(1);
}

function gpgAvailable(): boolean {
  const probe = spawnSync(["gpg", "--version"], {
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
  });
  return probe.success;
}

/**
 * Verify the signing key for `keyId` is usable WITHOUT any passphrase
 * prompt — the pre-condition for `git commit -S` to never hang a harness.
 *
 * Three checks run in order:
 *   (a) `gpg --list-keys <id>` — public key in the keyring (config error).
 *   (b) `gpg --list-secret-keys <id>` — secret key material present. NB:
 *       this reads the keyring only; it succeeds on a cold cache and says
 *       nothing about the passphrase cache.
 *   (c) cancel-mode trial sign — the agent can sign using only a cached
 *       passphrase. A cold cache fails here in milliseconds instead of
 *       deadlocking `git commit -S` on a pinentry prompt nobody answers.
 *
 * Each failure exits 1 with a distinct `hint:` prefix.
 */
export function assertGpgUnlocked(keyId: string | undefined | null): void {
  if (!keyId || !FINGERPRINT_RE.test(keyId) || keyId.length < MIN_LEN || keyId.length > MAX_LEN) {
    fail(
      "invalid-key",
      `Invalid AGENT_GPG_KEY_ID '${
        keyId ?? ""
      }'. Expected a 40-char (or 16/8-short) hex fingerprint.`,
    );
  }

  if (!gpgAvailable()) {
    fail(
      "key-not-in-keyring",
      "gpg binary not found on PATH. Install gnupg or fix the PATH.",
    );
  }

  const publicCheck = spawnSync(["gpg", "--list-keys", keyId], {
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
  });
  if (!publicCheck.success) {
    fail(
      "key-not-in-keyring",
      `GPG key ${keyId} is not in the keyring.\n`
        + `   Add it via: gpg --import <path-to-secret.asc>\n`
        + `   or update AGENT_GPG_KEY_ID in .credentials.env`,
    );
  }

  const secretCheck = spawnSync(["gpg", "--list-secret-keys", keyId], {
    stdout: "ignore",
    stderr: "ignore",
    env: process.env,
  });
  if (!secretCheck.success) {
    fail(
      "key-not-in-keyring",
      `Secret key for ${keyId} is not in the keyring.\n`
        + `   Add it via: gpg --import <path-to-secret.asc>\n`
        + `   or update AGENT_GPG_KEY_ID in .credentials.env`,
    );
  }

  // Cache probe — the check that actually matters pre-commit.
  // --list-secret-keys reads the keyring only and succeeds on a cold cache,
  // which previously let `git commit -S` spawn pinentry-tty and lock up
  // agent harnesses. The cancel-mode trial sign cannot prompt: warm cache
  // → silent SIG_CREATED; cold cache → "Operation cancelled" in millis.
  const probe = probeCachedPassphrase(keyId);
  if (!probe.warm) {
    fail(
      "key-not-unlocked",
      `GPG agent has no usable cached passphrase for ${keyId} (cache cold).\n`
        + `   Warm it first: giwt gpg-unlock`,
    );
  }
}

/**
 * Read `AGENT_GPG_KEY_ID` from the shared credentials loader and delegate
 * to `assertGpgUnlocked`. Use this when the caller does not have its own
 * `WorktreeConfig.agentGpgKeyId` — typically `merge.ts` and `finalize.ts`,
 * which derive the signing identity from `.credentials.env`.
 */
export function assertAgentGpgUnlocked(): void {
  if (!credentials.found) {
    fail(
      "key-not-in-keyring",
      "No agent GPG credentials loaded. Populate .credentials.env with AGENT_GPG_KEY_ID/NAME/EMAIL.",
    );
  }
  assertGpgUnlocked(credentials.keyId);
}
