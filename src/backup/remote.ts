// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Off-site transfer construction: `giwt backup remote` pushes the backup
 * root to a configured remote via rclone/rsync/ssh.
 *
 * Authorization (ticket caveats):
 * - server-side deletion (`--prune`/`--delete`) is refused unless the repo
 *   config explicitly sets `[backup] allow_remote_delete = true` AND the
 *   caller passes `--prune` — two-key authorization, default-deny;
 * - a failed verify never advances `offsiteAt`: the transfer runner only
 *   appends a `sync` event after verifyRoot reports every chain ok.
 */

import { closeSync, openSync } from "node:fs";
import { boundedSpawn, defaultSpawn } from "../doctor/check/spawn";
import type { BackupTool } from "./verify";

export type OffsiteKind = "rclone" | "rsync" | "ssh";

export const OFFSITE_KINDS: readonly OffsiteKind[] = ["rclone", "rsync", "ssh"];

export interface RemotePlanInput {
  kind: OffsiteKind;
  /** Local source directory (the backup root). */
  source: string;
  /** Remote destination: rclone remote:path, rsync [user@]host:path, or ssh host:path. */
  dest: string;
  /** Caller asked for server-side pruning (--prune). */
  prune: boolean;
  /** Repo config `[backup] allow_remote_delete`. */
  allowRemoteDelete: boolean;
  /** ssh mode only: archive file streamed over stdin. */
  archivePath?: string;
}

export interface RemotePlan {
  cmd: string[];
  /** Env var NAMES the transfer needs at runtime (never values). */
  envNames: readonly string[];
  /** stdin source for ssh streaming (absolute archive path), else null. */
  stdinFile: string | null;
}

/** Construct the transfer command; null when deletion is not authorized. */
export function buildRemoteCommand(input: RemotePlanInput): RemotePlan | null {
  const deleteAuthorized = input.prune && input.allowRemoteDelete;
  if (input.prune && !input.allowRemoteDelete) return null;
  if (input.kind === "rclone") {
    // rclone `copy` never deletes; `sync` mirrors (deletes server-side).
    return {
      cmd: ["rclone", deleteAuthorized ? "sync" : "copy", `${input.source}/`, input.dest],
      envNames: ["RCLONE_CONFIG"],
      stdinFile: null,
    };
  }
  if (input.kind === "rsync") {
    return {
      cmd: [
        "rsync",
        "-az",
        `${input.source}/`,
        input.dest,
        ...(deleteAuthorized ? ["--delete"] : []),
      ],
      envNames: ["RSYNC_PASSWORD"],
      stdinFile: null,
    };
  }
  // ssh: stream the newest archive over stdin into the destination path.
  const archive = input.archivePath ?? "";
  return {
    cmd: ["ssh", input.dest, `cat > ${archive.split("/").pop() ?? "archive.tar.zst"}`],
    envNames: ["GIWT_SSH_HOST", "GIWT_SSH_USER"],
    stdinFile: archive === "" ? null : archive,
  };
}

/**
 * Ticket partial-failure rule: `offsiteAt` advances ONLY after verify ok.
 * Pure gate — the runner calls this to decide whether a sync event may be
 * appended at all.
 */
export function advanceOffsite(verifyOk: boolean): boolean {
  return verifyOk;
}

export interface SpawnLike {
  (cmd: string[], cwd: string, stdinFile: string | null): Promise<{
    exitCode: number;
    stderr: string;
  }>;
}

/** Bounded runner over the doctor spawn seam; stdin sourced from a file fd. */
export function boundedRunner(timeoutMs: number): SpawnLike {
  const bounded = boundedSpawn(defaultSpawn, timeoutMs);
  return async (cmd, cwd, stdinFile) => {
    if (stdinFile === null) {
      const res = await bounded(cmd, cwd);
      return { exitCode: res.exitCode, stderr: res.stderr };
    }
    // The doctor seam does not model stdin; ssh streaming runs bounded here.
    const fd = openSync(stdinFile, "r");
    try {
      const proc = Bun.spawn(cmd, {
        cwd,
        stdin: fd,
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
      });
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      return { exitCode, stderr };
    } finally {
      closeSync(fd);
    }
  };
}

/** Bounded (cmd, cwd) spawn seam for backup tools, shared by all runners. */
export function backupTool(timeoutMs: number): BackupTool {
  const bounded = boundedSpawn(defaultSpawn, timeoutMs);
  return async (cmd, cwd) => await bounded(cmd, cwd);
}
