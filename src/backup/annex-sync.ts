// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup annex-sync` — orchestration lane driving `git annex sync
 * --content` through the SAME authorization as the `giwt git` passthrough.
 *
 * Design (recorded in FEAT-annex-sync-orchestration-lane-in-giwt-backup):
 * - Subcommand shape (not a dump-lane step): composable from cron/scripts
 *   (`backup annex-sync && backup dump && backup verify`), keeps dump
 *   latency untouched; sync-before-dump ordering stays operator guidance.
 * - Authorization: classifyGit (classifyGitInvocation + classifyAnnex)
 *   with the REPO's OWN policy lists only (skipGlobal) — a [git] allow in
 *   ~/.config/giwt/config.toml or env alone never authorizes. No raw
 *   spawn bypass exists: the classifier verdict precedes every spawn.
 * - Numcopies evidence: a read-only `git annex whereis` probe (the same
 *   RO seam as the dump advisory gate) must succeed before sync runs —
 *   annex unavailable / not an annex repo / probe failure = refusal.
 * - Outcome lands in .backup.jsonl as a `sync`-kind event (remote "",
 *   path = repo root), append-only + fsync'd; `backup status` shows it
 *   as `sync (local)`.
 */

import { classifyGit, type GitVerdict } from "../git/policy";
import { log, raw } from "../utils/output";
import { loadSettings } from "../utils/settings";
import { appendState } from "./state";

export interface AnnexSyncSpawn {
  (cmd: string[]): { exitCode: number; stdout: string; stderr: string; };
}

export interface AnnexSyncOptions {
  /** Repo root the sync runs in (also the ledger event path). */
  repoRoot: string;
  /** Tree dir hosting .backup.jsonl. */
  treeDir: string;
  /** Per-child budget for the probe + sync spawns (ms). */
  timeoutMs: number;
}

/** The policy lists the repo's OWN giwt.toml defines — global layer and
 *  environment can never widen them. */
export function repoPolicyLists(repoRoot: string): {
  safe: readonly string[];
  allow: readonly string[];
  deny: readonly string[];
} {
  const settings = loadSettings(repoRoot, { skipGlobal: true });
  return { safe: settings.git.safe, allow: settings.git.allow, deny: settings.git.deny };
}

/**
 * Run `git annex sync --content` in `options.repoRoot`, gated by the
 * passthrough classifier and a numcopies RO probe. Throws on refusal or
 * failure; appends exactly one `sync` event to the state ledger either way.
 */
export function runAnnexSync(
  options: AnnexSyncOptions,
  deps?: {
    /** Spawn seam (tests inject; production: Bun.spawnSync wrapper). */
    spawn?: AnnexSyncSpawn;
  },
): void {
  const spawn = deps?.spawn ?? defaultSpawn(options.timeoutMs);
  const { repoRoot, treeDir } = options;

  // 1. Authorization — server-side classification, no convenience check.
  const verdict: GitVerdict = classifyGit({
    args: ["annex", "sync"],
    lists: repoPolicyLists(repoRoot),
  });
  if (verdict.verdict === "block") {
    fail(treeDir, repoRoot, `authorization refused — ${verdict.reason}`);
    throw new Error(`backup annex-sync: authorization refused — ${verdict.reason}`);
  }

  // 2. Numcopies evidence: the RO probe must succeed, or nothing syncs.
  const probe = spawn(["git", "-C", repoRoot, "annex", "whereis"]);
  if (probe.exitCode !== 0) {
    const detail = probe.stderr.trim().split("\n")[0] ?? "no stderr";
    fail(
      treeDir,
      repoRoot,
      `numcopies unverifiable — git-annex whereis probe failed: ${detail}`,
    );
    throw new Error(
      `backup annex-sync: numcopies unverifiable — the read-only git-annex `
        + `probe failed (${detail}); refusing to sync without content assurance`,
    );
  }

  // 3. The authorized mutation, same two-token shape the classifier passed.
  const sync = spawn(["git", "-C", repoRoot, "annex", "sync", "--content"]);
  const out = sync.stdout.trim();
  if (sync.exitCode !== 0) {
    const tail = sync.stderr.trim().split("\n").slice(-2).join(" | ") || "no stderr";
    fail(treeDir, repoRoot, `git annex sync --content exited ${sync.exitCode}: ${tail}`);
    throw new Error(`backup annex-sync: git annex sync exited ${sync.exitCode} (${tail})`);
  }
  const copies = /^copy\s+\S+/m.exec(out);
  const note = copies !== null ? `converged; ${copies[0]}` : "converged";
  appendState(treeDir, {
    ts: new Date().toISOString(),
    kind: "sync",
    remote: "",
    path: repoRoot,
    ok: true,
    note,
  });
  log("success", `backup annex-sync: content converged (${note})`);
  raw(`  ${out.split("\n").slice(-3).join("\n  ")}`);
}

function fail(treeDir: string, repoRoot: string, note: string): void {
  appendState(treeDir, {
    ts: new Date().toISOString(),
    kind: "sync",
    remote: "",
    path: repoRoot,
    ok: false,
    note: note.slice(0, 200),
  });
  log("error", `backup annex-sync: ${note}`);
}

function defaultSpawn(
  timeoutMs: number,
): AnnexSyncSpawn {
  return (cmd) => {
    const res = Bun.spawnSync(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    return {
      exitCode: res.exitCode,
      stdout: res.stdout.toString(),
      stderr: res.stderr.toString(),
    };
  };
}
