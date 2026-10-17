// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup dump` transactional runner.
 *
 * Per run: PID lock (full-jitter retry) → mkdtemp staging inside the root →
 * per target: plan full/incremental from .snar state, quiesce sqlite via
 * `sqlite3 .backup`, tar --listed-incremental into staging, sha256 sidecar,
 * `zstd -t`, then atomic rename into the root (a name that already exists
 * is never overwritten — the stamp bumps). Only after EVERY archive is in
 * place and the youngest chain replays clean are the .snar states finalized
 * and GFS rotation run. Any earlier failure leaves the .snar untouched, so
 * the next dump rebuilds the same window.
 *
 * SIGINT/SIGTERM/SIGHUP and process exit tear down staging + lock (finalize
 * signal DNA); every external spawn is bounded by [backup] timeout_ms.
 */

import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { boundedSpawn, defaultSpawn } from "../doctor/check/spawn";
import { dumpTarget, type StagedSnar } from "./dump-target";
import { acquireBackupLock } from "./lock";
import {
  type BackupArchive,
  type DumpLevel,
  listArchives,
  newestFullMs,
  planNextLevel,
  safeTargetName,
  selectChain,
  snarPath,
  STATE_DIR,
  utcStamp,
} from "./plan";
import { findSqliteFiles, type QuiesceSkip } from "./quiesce";
import { type RotationPolicy, selectRotation } from "./rotation";
import { type BackupTool, verifyRoot } from "./verify";

/** Staging dirs live inside the root so renames stay on one filesystem. */
export const STAGING_PREFIX = ".staging-";

export interface ResolvedTarget {
  /** Target path as given (relative to the repo root, or "."). */
  target: string;
  targetAbs: string;
}

export interface DumpOptions {
  rootAbs: string;
  targets: ResolvedTarget[];
  keep: RotationPolicy;
  timeoutMs: number;
  /** sqlite3 CLI present (Bun.which) — DBs are skipped loudly otherwise. */
  sqliteAvailable: boolean;
  /** Dump root-owned target paths (default refuse). */
  allowRootOwned: boolean;
  /** Scratch area (repo [scratch] root, default .tmp) — dump verify replays
   *  extract here, never into /tmp root or another repo. */
  scratchRoot: string;
}

export interface DumpRecord {
  target: string;
  level: DumpLevel;
  archive: string;
  bytes: number;
  sha256: string;
}

export interface DumpPreviewRow {
  target: string;
  level: DumpLevel;
  dbs: number;
  wouldPrune: number;
}

export interface DumpRunResult {
  root: string;
  dumps: DumpRecord[];
  pruned: string[];
  skippedDbs: QuiesceSkip[];
}

/** No-write plan: level per target, DBs found, rotation impact. */
export function previewDump(options: DumpOptions): DumpPreviewRow[] {
  const now = Date.now();
  const archives = listArchives(options.rootAbs);
  return options.targets.map(({ target, targetAbs }) => {
    const safe = safeTargetName(target);
    const level = planNextLevel({
      snarExists: existsSync(snarPath(options.rootAbs, safe)),
      youngestFullMs: newestFullMs(archives, safe),
      now,
    });
    const dbs = findSqliteFiles(targetAbs).length;
    const future: BackupArchive[] = [...archives.filter((a) => a.target === safe), {
      target: safe,
      level,
      stamp: utcStamp(new Date(now)),
      archive: "(new)",
      sidecar: "(new).sha256",
    }];
    return {
      target,
      level,
      dbs,
      wouldPrune: selectRotation({ archives: future, policy: options.keep }).prune.length,
    };
  });
}

const BACKUP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Transactional dump: lock → staging → per-target tar/sha256/zstd → rename
 * → replay-verify → snar finalize → rotation. Throws (after leaving .snar
 * state and staging consistent) on refusals, tool failures, or a failed
 * verify.
 */
export async function runDump(options: DumpOptions): Promise<DumpRunResult> {
  mkdirSync(options.rootAbs, { recursive: true });
  const releaseLock = acquireBackupLock(options.rootAbs);
  const staging = mkdtempSync(join(options.rootAbs, STAGING_PREFIX));
  const teardown = (): void => {
    releaseLock();
    rmSync(staging, { recursive: true, force: true });
  };
  const onSignal = (): void => {
    teardown();
    process.exit(130);
  };
  const signalListeners: Array<[NodeJS.Signals, NodeJS.SignalsListener]> = [];
  for (const sig of BACKUP_SIGNALS) {
    const listener: NodeJS.SignalsListener = () => onSignal();
    process.on(sig, listener);
    signalListeners.push([sig, listener]);
  }
  const onExit = (): void => teardown();
  process.on("exit", onExit);
  try {
    return await dumpLocked(options, staging);
  } finally {
    for (const [sig, listener] of signalListeners) process.removeListener(sig, listener);
    process.removeListener("exit", onExit);
    teardown();
  }
}

async function dumpLocked(options: DumpOptions, staging: string): Promise<DumpRunResult> {
  const now = Date.now();
  const stamp = utcStamp(new Date(now));
  const created = new Date(now).toISOString();
  mkdirSync(join(options.rootAbs, STATE_DIR), { recursive: true });
  const rawTool = boundedSpawn(defaultSpawn, options.timeoutMs);
  // The doctor SpawnFn allows sync-injected fakes; the backup engine always
  // awaits real spawns, so normalize to a promise-returning seam.
  const tool: BackupTool = async (cmd, cwd) => await rawTool(cmd, cwd);
  const runSqlite = async (args: string[]): Promise<{ exitCode: number; stderr: string; }> => {
    const res = await tool(args, staging);
    return { exitCode: res.exitCode, stderr: res.stderr };
  };

  const dumps: DumpRecord[] = [];
  const problems: string[] = [];
  const skippedDbs: QuiesceSkip[] = [];
  const staged: StagedSnar[] = [];

  for (const { target, targetAbs } of options.targets) {
    const step = await dumpTarget({
      target,
      targetAbs,
      rootAbs: options.rootAbs,
      staging,
      tool,
      runSqlite,
      sqliteAvailable: options.sqliteAvailable,
      allowRootOwned: options.allowRootOwned,
      stamp,
      created,
      now,
    });
    if (step.record !== null) dumps.push(step.record);
    if (step.staged !== null) staged.push(step.staged);
    problems.push(...step.problems);
    skippedDbs.push(...step.skippedDbs);
  }

  if (problems.length > 0) {
    throw new Error(
      `backup dump failed — .snar chains left untouched (${problems.length} problem(s)): ${
        problems.join("; ")
      }`,
    );
  }

  // Replay-verify BEFORE the chain state is finalized: a failed replay
  // leaves every .snar in staging, so the next dump rebuilds the window.
  const verdicts = await verifyRoot({
    rootAbs: options.rootAbs,
    targets: dumps.map((d) => safeTargetName(d.target)),
    tool,
    scratchRoot: options.scratchRoot,
  });
  const failed = verdicts.filter((v) => !v.ok);
  if (failed.length > 0) {
    throw new Error(
      `backup verify failed after dump — .snar chains left untouched: ${
        failed.map((v) => `${v.target}: ${v.reason ?? "failed"}`).join("; ")
      }`,
    );
  }

  for (const s of staged) renameSync(s.stagingSnar, s.stateSnar);

  // GFS rotation: only after a successful verify, and only over each
  // dumped target's own archives. The live chain (youngest full + its
  // incrementals) is pinned — pruning under open incrementals would
  // orphan them.
  const pruned: string[] = [];
  const fresh = listArchives(options.rootAbs);
  for (const safe of new Set(staged.map((s) => s.safe))) {
    const liveChain = selectChain(fresh, safe).map((a) => a.archive);
    const plan = selectRotation({
      archives: fresh.filter((a) => a.target === safe),
      policy: options.keep,
      pinned: new Set(liveChain),
    });
    for (const archive of plan.prune) {
      rmSync(join(options.rootAbs, archive.archive), { force: true });
      rmSync(join(options.rootAbs, archive.sidecar), { force: true });
      pruned.push(archive.archive);
    }
  }
  return { root: options.rootAbs, dumps, pruned, skippedDbs };
}
