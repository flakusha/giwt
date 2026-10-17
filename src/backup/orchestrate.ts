// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Orchestration runners for `giwt backup` subcommands: status (state ledger
 * + staleness + annex counts), schedule (unit generation), remote (off-site
 * transfer behind the verify gate). All output goes through log()/raw();
 * mutating paths append to `.backup.jsonl` only, nothing else is written.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { type WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";
import { type AnnexCounts, annexCounts } from "./annex-status";
import { discoverPeers, type DiscoveryResult } from "./discover";
import { listArchives } from "./plan";
import {
  advanceOffsite,
  backupTool,
  boundedRunner,
  buildRemoteCommand,
  type OffsiteKind,
} from "./remote";
import { renderSchedule } from "./schedule";
import {
  appendState,
  type BackupEvent,
  lastSuccessRow,
  parseDuration,
  readState,
  stalenessAlert,
} from "./state";
import { verifyRoot } from "./verify";

const STALENESS_DEFAULT_MS = 24 * 3_600_000;

export interface StatusOptions {
  staleness: string;
  strict: boolean;
  annex: boolean;
  now?: number;
}

/** `backup status`: last success per kind/remote + staleness gate. */
export function runStatusCommand(
  config: WorktreeConfig,
  options: StatusOptions,
  deps?: {
    annex?: (repoRoot: string) => AnnexCounts;
  },
): number {
  const maxAgeMs = parseDuration(options.staleness) ?? STALENESS_DEFAULT_MS;
  const events = readState(config.worktreeRoot);
  const now = options.now ?? Date.now();
  raw("backup status:");
  for (const kind of ["dump", "verify", "sync", "copy"] as const) {
    for (const remote of remotesOf(events, kind)) {
      raw(lastSuccessRow(events, kind, remote));
    }
  }
  const alert = stalenessAlert(events, now, maxAgeMs);
  if (alert === null) {
    log("info", `staleness: within budget (${options.staleness})`);
  } else {
    log("warn", `staleness: ${alert}`);
    appendState(config.worktreeRoot, {
      ts: new Date(now).toISOString(),
      kind: "alert",
      remote: "",
      path: "",
      ok: false,
      note: alert,
    });
    if (options.strict) return 1;
  }
  if (options.annex) {
    const counts = deps?.annex !== undefined
      ? deps.annex(config.repoRoot)
      : annexCounts(config.repoRoot, spawnSyncRows());
    raw(`  annex whereis files: ${counts.whereisFiles}`);
    raw(`  annex unused keys: ${counts.unusedKeys}`);
    if (counts.note !== "") log("warn", counts.note);
  }
  return 0;
}

function remotesOf(events: readonly BackupEvent[], kind: string): string[] {
  const names = new Set<string>();
  for (const e of events) {
    if (e.kind === kind) names.add(e.remote);
  }
  return [...names].sort();
}

function spawnSyncRows(): (cmd: string[]) => { exitCode: number; stdout: string; stderr: string; } {
  return (cmd) => {
    const res = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: res.exitCode,
      stdout: res.stdout.toString(),
      stderr: res.stderr.toString(),
    };
  };
}

export interface ScheduleOptions {
  dryRun: boolean;
  remoteKind: string;
  staleness: string;
  calendar: string;
}

/** `backup schedule [--dry-run]`: pure, byte-identical unit output. */
export function runScheduleCommand(options: ScheduleOptions): void {
  const rendered = renderSchedule({
    remoteKind: options.remoteKind,
    staleness: options.staleness,
    calendar: options.calendar,
  });
  raw(rendered.systemd);
  raw(rendered.cron);
  if (rendered.envNames.length > 0) {
    log(
      "info",
      `required env names: ${rendered.envNames.join(", ")} (values stay in /etc/giwt-backup.env)`,
    );
  }
}

export interface RemoteOptions {
  kind: OffsiteKind;
  dest: string;
  prune: boolean;
  discover: boolean;
}

/** `backup remote`: verify gate → transfer → append sync event with offsiteAt. */
export async function runRemoteCommand(
  config: WorktreeConfig,
  options: RemoteOptions,
  deps?: {
    discover?: () => Promise<DiscoveryResult>;
  },
): Promise<void> {
  if (options.discover) {
    const result = deps?.discover !== undefined
      ? await deps.discover()
      : await discoverPeers(boundedStatusSpawn());
    for (const peer of result.peers) {
      raw(`  ${peer.dnsName}${peer.online ? "" : " (offline)"} → try: --dest ${peer.hostName}`);
    }
    if (result.note !== "") log("warn", `discover: ${result.note}`);
    return;
  }
  if (options.dest === "") {
    throw new Error(
      "backup remote: --dest <remote> is required (or --discover to list candidates)",
    );
  }
  const rootAbs = join(config.repoRoot, config.settings.backup.root);
  if (!existsSync(rootAbs)) {
    throw new Error(`backup remote: no backup root at ${rootAbs} — run 'backup dump' first`);
  }
  // Verify gate: a failed verify never advances offsiteAt.
  const timeoutMs = config.settings.backup.timeoutMs;
  const verdicts = await verifyRoot({
    rootAbs,
    targets: targetNames(rootAbs),
    tool: backupTool(timeoutMs),
    scratchRoot: join(config.worktreeRoot, config.settings.scratch.root),
  });
  const failed = verdicts.filter((v) => !v.ok);
  if (!advanceOffsite(failed.length === 0)) {
    appendState(config.worktreeRoot, {
      ts: new Date().toISOString(),
      kind: "verify",
      remote: options.dest,
      path: rootAbs,
      ok: false,
      note: `verify failed — offsite transfer refused: ${failed.map((f) => f.target).join(", ")}`,
    });
    throw new Error(
      `backup remote: verify failed for ${
        failed.map((f) => f.target).join(", ")
      } — offsiteAt NOT advanced`,
    );
  }
  const plan = buildRemoteCommand({
    kind: options.kind,
    source: rootAbs,
    dest: options.dest,
    prune: options.prune,
    allowRemoteDelete: config.settings.backup.allowRemoteDelete,
  });
  if (plan === null) {
    throw new Error(
      "backup remote: server-side deletion refused — set [backup] allow_remote_delete = true in giwt.toml AND pass --prune",
    );
  }
  const runner = boundedRunner(timeoutMs);
  const res = await runner(plan.cmd, config.repoRoot, plan.stdinFile);
  if (res.exitCode !== 0) {
    throw new Error(
      `backup remote: ${options.kind} exited ${res.exitCode} (${res.stderr.trim().slice(0, 200)})`,
    );
  }
  appendState(config.worktreeRoot, {
    ts: new Date().toISOString(),
    kind: "sync",
    remote: options.dest,
    path: rootAbs,
    ok: true,
    offsiteAt: new Date().toISOString(),
  });
  log(
    "success",
    `synced ${rootAbs} → ${options.dest} (${options.kind}${options.prune ? ", prune" : ""})`,
  );
}

/** Unique safe target names present in the backup root's archive listing. */
function targetNames(rootAbs: string): string[] {
  return [...new Set(listArchives(rootAbs).map((a) => a.target))];
}

function boundedStatusSpawn(): (cmd: string[]) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return async (cmd) => {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", timeout: 15_000 });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  };
}
