// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt backup` arg gates for the status/schedule/remote subcommands:
 * flag parsing + validation before handing off to the orchestration
 * runners in `src/backup/orchestrate.ts`. Also owns the HELP text and
 * the shared usageError used by the dump/verify dispatch.
 */

import { runAnnexSync } from "../backup/annex-sync";
import { runRemoteCommand, runScheduleCommand, runStatusCommand } from "../backup/orchestrate";
import { OFFSITE_KINDS } from "../backup/remote";
import { parseDuration } from "../backup/state";
import type { WorktreeConfig } from "../utils/config";

export const HELP = `backup <dump|verify|annex-sync|status|schedule|remote> [flags]
  dump     tar.zst archive per target (weekly full + incremental .snar chain,
           sha256 sidecar, zstd -t after write, GFS rotation after verify)
  verify   replay the youngest full+increment chain per target into the
           repo scratch area and assert the tar table + manifest presence
  annex-sync drive 'git annex sync --content' behind the SAME [git] allow
           policy as the 'giwt git' passthrough (repo giwt.toml decides;
           global config or env alone never authorizes); refuses when
           numcopies is unverifiable (RO whereis probe) and records the
           outcome as a 'sync' event in .backup.jsonl (visible as
           'sync (local)' in status). Operator ordering guidance: run it
           BEFORE 'backup dump' in cron chains ('backup annex-sync &&
           backup dump && backup verify') so archives capture converged
           content — the dump lane never syncs on its own
  status   last success per kind/remote from .backup.jsonl; staleness gate:
           --staleness <n><s|m|h|d> (default 24h), --strict exits 1 when
           stale (cron-visible), --annex adds read-only git-annex counts
  schedule emit systemd timer+service and cron units pinned to this giwt
           binary (--dry-run is the documented form; output is pure and
           byte-identical; env var NAMES only, values belong in
           /etc/giwt-backup.env; --remote <rclone|rsync|ssh>, --calendar)
  remote   off-site transfer: --target rclone|rsync|ssh --dest <remote>
           [--prune] (server-side deletion REFUSED unless
           [backup] allow_remote_delete = true in giwt.toml);
           [--discover] lists tailscale MagicDNS candidates (best effort);
           a failed verify never advances offsiteAt
  --dry-run   (dump only) print the plan without writing anything
  Targets default to [backup] targets (else the repo root); archives land
  under [backup] root (default .backups).`;

export function usageError(message: string): never {
  throw new Error(`backup: ${message}\n${HELP}`);
}

function flagValue(rest: string[], flag: string): string {
  const index = rest.indexOf(flag);
  return index >= 0 ? rest[index + 1] ?? "" : "";
}

export async function runStatusGate(rest: string[], config: WorktreeConfig): Promise<void> {
  const staleness = flagValue(rest, "--staleness");
  if (staleness !== "" && parseDuration(staleness) === null) {
    usageError(`--staleness expects <n><s|m|h|d> (got '${staleness}')`);
  }
  const exit = runStatusCommand(config, {
    staleness: staleness === "" ? "24h" : staleness,
    strict: rest.includes("--strict"),
    annex: rest.includes("--annex"),
  });
  if (exit !== 0) process.exitCode = 1;
}

export function runScheduleGate(rest: string[]): void {
  runScheduleCommand({
    dryRun: rest.includes("--dry-run"),
    remoteKind: flagValue(rest, "--remote"),
    staleness: flagValue(rest, "--staleness") || "24h",
    calendar: flagValue(rest, "--calendar") || "daily",
  });
}

/** `backup annex-sync` gate: no flags today — any flag is a usage error,
 *  keeping the lane surface as narrow as its authorization. */
export function runAnnexSyncGate(rest: string[], config: WorktreeConfig): void {
  const unknown = rest.find((arg) => arg.startsWith("-"));
  if (unknown !== undefined) {
    usageError(`annex-sync takes no flags (got '${unknown}')`);
  }
  runAnnexSync({
    repoRoot: config.repoRoot,
    treeDir: config.worktreeRoot,
    timeoutMs: config.settings.backup.timeoutMs,
  });
}

export async function runRemoteGate(rest: string[], config: WorktreeConfig): Promise<void> {
  const kindValue = flagValue(rest, "--target");
  const kind = OFFSITE_KINDS.find((k) => k === kindValue);
  if (kindValue !== "" && kind === undefined) {
    usageError(`--target expects rclone|rsync|ssh (got '${kindValue}')`);
  }
  await runRemoteCommand(config, {
    kind: kind ?? "rsync",
    dest: flagValue(rest, "--dest"),
    prune: rest.includes("--prune") || rest.includes("--delete"),
    discover: rest.includes("--discover"),
  });
}
