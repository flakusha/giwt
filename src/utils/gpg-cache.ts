// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * gpg-agent passphrase-cache primitives.
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
 *   - The cancel-mode probe does NOT re-arm the TTL. Only a real sign that
 *     consumes the cached passphrase re-arms default-cache-ttl (capped by
 *     max-cache-ttl), so the warm path performs a real sign to prolong.
 *
 * Usage:
 *   import { probeCachedPassphrase, warmAgentCache } from "../utils/gpg-cache";
 */

import { spawnSync } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  timeoutMs?: number;
}

export interface SignResult {
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
export function runSign(keyId: string, { mode, passphrase = "", timeoutMs }: SignOpts): SignResult {
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
    timeout: timeoutMs ?? (mode === "default" ? 180_000 : 15_000),
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

// ── Reusable cold→warm helper (public API) ─────────────────────

export type WarmAgentCacheVia = "passphrase-source" | "pinentry" | "none";

export interface WarmAgentCacheResult {
  /** True only when the cache is VERIFIABLY warm (re-probed after warming). */
  warm: boolean;
  /** Which path of the decision tree produced the result. */
  via: WarmAgentCacheVia;
  /** gpg stderr from the failed attempt ("" when warm or refused). */
  stderrOut: string;
}

export interface WarmAgentCacheOptions {
  /** Called before each warming attempt starts ("passphrase-source" or
   * "pinentry"), so interactive callers can announce before blocking. */
  announce?: (via: Exclude<WarmAgentCacheVia, "none">) => void;
}

/**
 * Go from a cold gpg-agent cache to a verifiably warm one, running the same
 * decision tree as `giwt gpg-unlock`:
 *
 * 1. headless passphrase source (GIT_GPG_PASSPHRASE or ~/.gpg-passphrase),
 *    warmed via loopback batch mode;
 * 2. pinentry prompt — ONLY when `process.stdin.isTTY` (the TTY guard is
 *    internal; callers never prompt without a TTY);
 * 3. otherwise an honest refusal (`via: "none"`) — this is a NON-HANG
 *    guarantee for agent-harness callers: the function never blocks waiting
 *    for input outside a TTY.
 *
 * Success is only reported after a re-probe with
 * {@linkcode probeCachedPassphrase} confirms the passphrase is cached.
 */
export function warmAgentCache(
  keyId: string,
  opts: WarmAgentCacheOptions = {},
): WarmAgentCacheResult {
  const passphrase = passphraseSource();
  if (passphrase) {
    opts.announce?.("passphrase-source");
    const warmed = warmCacheViaPassphrase(keyId, passphrase);
    if (warmed.ok && probeCachedPassphrase(keyId).warm) {
      return { warm: true, via: "passphrase-source", stderrOut: "" };
    }
    return { warm: false, via: "passphrase-source", stderrOut: warmed.stderrOut };
  }

  if (process.stdin.isTTY) {
    opts.announce?.("pinentry");
    const warmed = warmCacheViaPinentry(keyId);
    if (warmed.ok && probeCachedPassphrase(keyId).warm) {
      return { warm: true, via: "pinentry", stderrOut: "" };
    }
    return { warm: false, via: "pinentry", stderrOut: warmed.stderrOut };
  }

  return { warm: false, via: "none", stderrOut: "" };
}
