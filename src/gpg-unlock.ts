#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * GPG passphrase cache manager for giwt agent commits.
 *
 * Semantics verified against gpg 2.5.21 (temp-GNUPGHOME rig, 2026-09-12):
 *
 *   - `PRESET_PASSPHRASE` cannot prolong the cache. The passphrase-bytes
 *     form (`PRESET_PASSPHRASE <grip> <ttl> <hex>`) answers `ERR 67108933
 *     Not implemented`; the `-1`/hex-timestamp form answers OK but creates a
 *     PHANTOM entry — `KEYINFO` then claims cached=1 while any real sign
 *     still fails. The old prolong path was a silent no-op on cold caches
 *     (it printed "TTL refreshed" without warming anything) and is removed.
 *   - `KEYINFO`'s cached flag mirrors phantom entries, so it is not a
 *     trustworthy warm/cold oracle either.
 *   - The only honest probe is exercising the key: a trial sign with
 *     `--pinentry-mode cancel`. Warm → exit 0 + SIG_CREATED, fully silent.
 *     Cold → "Operation cancelled" within milliseconds (the pinentry is
 *     cancelled before it is shown), so it can never hang or prompt — safe
 *     to call from any context, including agent harnesses.
 *   - Warming: a sign with the agent's real pinentry (TTY contexts) or with
 *     `--batch --pinentry-mode loopback --passphrase <pw>` (headless; needs
 *     GIT_GPG_PASSPHRASE or ~/.gpg-passphrase). Both leave the passphrase
 *     in the agent cache — verified: a cancel-mode sign succeeds right after.
 *   - Every silent use of the cached passphrase re-arms default-cache-ttl
 *     (capped by max-cache-ttl), so "prolong" is the probe sign itself.
 *
 * Usage:
 *   giwt gpg-unlock
 */

import { spawnSync } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { credentials } from "./utils/credentials";
import { log, raw } from "./utils/output";

// ── Credentials ──────────────────────────────────────────────────

function loadCredentials(): string {
  if (!credentials.keyId) {
    log("error", String("Error: AGENT_GPG_KEY_ID not set in .credentials.env").replace(/\n$/, ""));
    log(
      "error",
      String("Copy .credentials.env.example and fill in your values.").replace(/\n$/, ""),
    );
    process.exit(1);
  }
  return credentials.keyId;
}

// ── gpg-agent config ─────────────────────────────────────────────

function agentConfigPath(): string {
  // GNUPGHOME is the keyring root directly (no ".gnupg" suffix appended);
  // otherwise HOME → USERPROFILE → /tmp keeps path.join away from "".
  if (process.env.GNUPGHOME) {
    return join(process.env.GNUPGHOME, "gpg-agent.conf");
  }
  const homeRoot = process.env.HOME ?? process.env.USERPROFILE;
  return homeRoot
    ? join(homeRoot, ".gnupg", "gpg-agent.conf")
    : join("/tmp", "gpg-agent.conf");
}

function readAgentConfInt(key: string, fallback: number): number {
  const confPath = agentConfigPath();
  if (!existsSync(confPath)) return fallback;
  const content = readFileSync(confPath, "utf8");
  let value = fallback;
  for (const rawLine of content.split("\n")) {
    const m = rawLine.replace(/#.*$/, "").trim().match(new RegExp(`^${key}\\s+(\\d+)`));
    if (m) value = parseInt(m[1]!, 10); // last occurrence wins, as in gpg
  }
  return value;
}

/**
 * Effective cache window in seconds: min(default-cache-ttl, max-cache-ttl).
 * Each silent use of the cached passphrase re-arms default-cache-ttl;
 * max-cache-ttl caps the total lifetime (defaults per gpg-agent docs).
 */
export function effectiveCacheTtl(): number {
  return Math.min(
    readAgentConfInt("default-cache-ttl", 600),
    readAgentConfInt("max-cache-ttl", 7200),
  );
}

// ── Sign helpers ─────────────────────────────────────────────────

interface SignOpts {
  mode: string;
  passphrase?: string;
}

interface SignResult {
  exitCode: number | null;
  sigCreated: boolean;
  statusOut: string;
  stderrOut: string;
}

/**
 * One clearsign of the empty message to /dev/null — exercises the signing
 * key through gpg-agent. `--yes` avoids the /dev/null overwrite prompt;
 * stdin "ignore" gives gpg immediate EOF (Bun.spawnSync exposes no stdin
 * handle, so "pipe" would deadlock — gpg would wait for EOF forever).
 */
function runSign(keyId: string, { mode, passphrase = "" }: SignOpts): SignResult {
  const args = ["gpg"];
  if (passphrase) {
    args.push("--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", passphrase);
  } else {
    args.push("--pinentry-mode", mode, "--yes");
  }
  args.push("--status-fd", "1", "--local-user", keyId, "--clearsign", "--output", "/dev/null");

  const proc = spawnSync(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // cancel/batch modes cannot prompt, so 15s is generous; the pinentry
    // path gets room for a human to type. Bun SIGTERMs the child on expiry.
    timeout: mode === "default" ? 180_000 : 15_000,
    env: process.env,
  });
  const statusOut = proc.stdout.toString("utf8");
  const stderrOut = proc.stderr.toString("utf8");
  return {
    exitCode: proc.exitCode,
    sigCreated: /SIG_CREATED/.test(statusOut),
    statusOut,
    stderrOut,
  };
}

export interface CacheProbe {
  warm: boolean;
  exitCode: number | null;
  sigCreated: boolean;
  stderrOut: string;
}

/**
 * Honest warm/cold probe for the agent's passphrase cache: trial sign with
 * pinentry cancelled. Can never prompt or hang, so it is safe to call from
 * any context — src/utils/gpg.ts gates every signing flow on this.
 */
export function probeCachedPassphrase(keyId: string): CacheProbe {
  const r = runSign(keyId, { mode: "cancel" });
  return {
    warm: r.exitCode === 0 && r.sigCreated,
    exitCode: r.exitCode,
    sigCreated: r.sigCreated,
    stderrOut: r.stderrOut,
  };
}

/**
 * Populate the cache headlessly by handing gpg the passphrase directly
 * (loopback batch mode). Verified to leave the passphrase in the agent
 * cache, not just inside the gpg process.
 */
export function warmCacheViaPassphrase(
  keyId: string,
  passphrase: string,
): { ok: boolean; sigCreated: boolean; stderrOut: string; } {
  const r = runSign(keyId, { mode: "loopback", passphrase });
  return { ok: r.exitCode === 0 && r.sigCreated, sigCreated: r.sigCreated, stderrOut: r.stderrOut };
}

/**
 * Populate the cache via the agent's configured pinentry (pinentry-tty by
 * default). REQUIRES a controlling TTY — callers must guard with
 * `process.stdin.isTTY`, otherwise the sign fails at the pinentry layer
 * (surfaced via `ok: false` with gpg's stderr).
 */
function warmCacheViaPinentry(
  keyId: string,
): { ok: boolean; sigCreated: boolean; stderrOut: string; } {
  const r = runSign(keyId, { mode: "default" });
  return { ok: r.exitCode === 0 && r.sigCreated, sigCreated: r.sigCreated, stderrOut: r.stderrOut };
}

/**
 * Optional headless passphrase source: GIT_GPG_PASSPHRASE or
 * ~/.gpg-passphrase. Absent means "use pinentry" — the tool never
 * requires a passphrase file to exist.
 */
function passphraseSource(): string | null {
  if (process.env.GIT_GPG_PASSPHRASE) return process.env.GIT_GPG_PASSPHRASE;
  const homeRoot = process.env.HOME ?? process.env.USERPROFILE;
  if (!homeRoot) return null;
  try {
    const pw = readFileSync(join(homeRoot, ".gpg-passphrase"), "utf8").trim();
    return pw || null;
  } catch {
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────

/** Subcommand entry point (registered in src/cli.ts as `giwt gpg-unlock`). */
export function runGpgUnlock(): void {
  const keyId = loadCredentials();
  const ttl = effectiveCacheTtl();
  raw(`GPG key: ${keyId.slice(0, 8)}... (effective cache TTL ${ttl}s)`);

  if (probeCachedPassphrase(keyId).warm) {
    raw("Cache is warm (verified by silent sign); re-running re-arms the TTL window.");
    process.exit(0);
  }

  const passphrase = passphraseSource();
  if (passphrase) {
    raw("Cache is cold — warming via loopback passphrase source...");
    const warmed = warmCacheViaPassphrase(keyId, passphrase);
    if (warmed.ok && probeCachedPassphrase(keyId).warm) {
      raw("Passphrase cached (verified).");
      process.exit(0);
    }
    log(
      "error",
      String("Failed — the passphrase source did not warm the cache:").replace(/\n$/, ""),
    );
    if (warmed.stderrOut.trim()) {
      log("error", String(`gpg stderr: ${warmed.stderrOut.trim()}`).replace(/\n$/, ""));
    }
    process.exit(1);
  }

  if (process.stdin.isTTY) {
    raw("Cache is cold — enter the key passphrase at the pinentry prompt...");
    const warmed = warmCacheViaPinentry(keyId);
    if (warmed.ok && probeCachedPassphrase(keyId).warm) {
      raw("Passphrase cached (verified).");
      process.exit(0);
    }
    log(
      "error",
      String("Failed — gpg-agent did not accept a passphrase for this key.").replace(/\n$/, ""),
    );
    if (warmed.stderrOut.trim()) {
      log("error", String(`gpg stderr: ${warmed.stderrOut.trim()}`).replace(/\n$/, ""));
    }
    process.exit(1);
  }

  log(
    "error",
    String("Cache is cold, and this context has no TTY and no passphrase source.").replace(
      /\n$/,
      "",
    ),
  );
  log("error", String("Run `giwt gpg-unlock` in your terminal to warm it.").replace(/\n$/, ""));
  process.exit(1);
}
