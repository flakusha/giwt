// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pijul backend for the VCS primitive seam. Pijul has no workspaces or ref
 * CAS: each agent owns a full clone directory, changes are intrinsic patch
 * ids, and commits are `pijul record`. No git spawn occurs on this path.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type VcsBackend, vcsBackendRemedy, type VcsBranch, type VcsWorkspace } from "./types";

/** Protocol/signature format changed between betas: pin one exact build. */
export const PIJUL_PINNED_VERSION = "1.0.0-beta.24";
const CLONE_MARKER = ".giwt-pijul-clone.json";
const BASE_CHANNEL = "main";

export interface PijulResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable pijul CLI seam. `cmd` always starts with `pijul`, never `git`. */
export type PijulSpawn = (cmd: string[], cwd: string) => PijulResult;

export const defaultPijulSpawn: PijulSpawn = (cmd, cwd) => {
  try {
    const proc = Bun.spawnSync(cmd, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    return {
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      exitCode: proc.exitCode ?? 1,
    };
  } catch (err) {
    return { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: 127 };
  }
};

function remedy(): string {
  return `need pijul ${PIJUL_PINNED_VERSION} exactly (protocol/signature broke between betas); `
    + `load an SSH key with ssh-add and run pijul identity new if signing fails; `
    + vcsBackendRemedy("pijul");
}

function parseVersion(output: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(output);
  return m === null
    ? null
    : `${m[1]}.${m[2]}.${m[3]}${m[4] === undefined ? "" : `-beta.${m[4]}`}`;
}

interface CloneMarker {
  root: string;
  branch: string;
}

/** Extract intrinsic change hashes from pijul's hash-only/json or plain output. */
export function changeHashes(output: string): Set<string> {
  const trimmed = output.trim();
  if (trimmed === "" || trimmed.startsWith("No matching logs found")) return new Set();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return new Set(
        parsed.map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            const record = item as Record<string, unknown>;
            for (const key of ["hash", "change", "id"]) {
              if (typeof record[key] === "string") return record[key] as string;
            }
          }
          return "";
        }).filter((hash) => hash !== ""),
      );
    }
  } catch {
    // Plain `pijul log --hash-only` prints one hash per line.
  }
  return new Set(
    trimmed.split(/\s+/).filter((token) => /^[A-Za-z0-9._=-]{20,}$/.test(token)),
  );
}

/** Build a backend around an injected pijul spawn seam (tests inject a stub). */
export function makePijulBackend(spawn: PijulSpawn): VcsBackend {
  const exec = (cmd: string[], cwd: string): PijulResult => spawn(["pijul", ...cmd], cwd);

  const fail = (cmd: string[], result: PijulResult): never => {
    throw new Error(
      `pijul ${cmd.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.trim()}. `
        + remedy(),
    );
  };

  const run = (cmd: string[], cwd: string): string => {
    const result = exec(cmd, cwd);
    if (result.exitCode !== 0) fail(cmd, result);
    return result.stdout.trim();
  };

  const guards = new Map<string, Promise<void>>();
  const guard = (cwd: string): Promise<void> => {
    let pending = guards.get(cwd);
    if (pending === undefined) {
      pending = (async () => {
        const version = exec(["--version"], cwd);
        if (version.exitCode !== 0) fail(["--version"], version);
        const found = parseVersion(version.stdout);
        if (found !== PIJUL_PINNED_VERSION) {
          throw new Error(
            `pijul version '${found ?? version.stdout.trim()}' is not supported (need exactly `
              + `${PIJUL_PINNED_VERSION}). ${remedy()}`,
          );
        }
      })();
      guards.set(cwd, pending);
    }
    return pending;
  };

  const hashes = async (cwd: string, channel: string): Promise<Set<string>> =>
    changeHashes(run(["log", "--hash-only", "--output-format", "json", "--channel", channel], cwd));

  const markerAt = (path: string): CloneMarker | null => {
    if (!existsSync(path)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(path, CLONE_MARKER), "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        const marker = parsed as Partial<CloneMarker>;
        if (typeof marker.root === "string" && typeof marker.branch === "string") {
          return { root: marker.root, branch: marker.branch };
        }
      }
    } catch {
      // Not a giwt-managed clone.
    }
    return null;
  };

  return {
    name: "pijul",

    async listBranches(root) {
      await guard(root);
      const branches: VcsBranch[] = [];
      for (const line of run(["channel"], root).split("\n")) {
        const current = line.trimStart().startsWith("*");
        const name = line.trim().replace(/^\*\s*/, "").trim();
        if (name !== "") branches.push({ name, current });
      }
      return branches;
    },

    async listWorkspaces(root) {
      const wanted = resolve(root);
      const workspaces: VcsWorkspace[] = [];
      const seen = new Set<string>();
      for (const parent of new Set([dirname(root), join(root, "tree")])) {
        if (!existsSync(parent)) continue;
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const path = join(parent, entry.name);
          const marker = markerAt(path);
          if (marker === null || resolve(marker.root) !== wanted || seen.has(path)) continue;
          seen.add(path);
          workspaces.push({ path, branch: marker.branch });
        }
      }
      return workspaces;
    },

    async status(root, branch) {
      await guard(root);
      const [own, base] = await Promise.all([hashes(root, branch), hashes(root, BASE_CHANNEL)]);
      let ahead = 0;
      for (const hash of own) if (!base.has(hash)) ahead++;
      let behind = 0;
      for (const hash of base) if (!own.has(hash)) behind++;
      const raw = run(["status", "--output-format", "json"], root);
      let clean = raw === "";
      if (raw !== "") {
        try {
          const parsed = JSON.parse(raw) as { changes?: unknown[]; };
          clean = (parsed.changes ?? []).length === 0;
        } catch {
          clean = false;
        }
      }
      return { branch, ahead, behind, clean };
    },

    async diff(root, branch) {
      await guard(root);
      const raw = run(["diff", "--channel", branch, "--output-format", "json"], root);
      if (raw === "") return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null
          ? Object.keys(parsed as Record<string, unknown>)
          : [];
      } catch {
        return [];
      }
    },

    async commit({ cwd, message }) {
      await guard(cwd);
      run(["record", "-a", "-m", message], cwd);
      const latest = changeHashes(
        run(["log", "--hash-only", "--output-format", "json", "--limit", "1"], cwd),
      );
      const sha = latest.values().next().value;
      if (sha === undefined) throw new Error(`pijul record produced no change hash. ${remedy()}`);
      return { sha };
    },

    async createWorkspace({ root, path, branch, base }) {
      await guard(root);
      const cmd = ["clone"];
      if (base !== undefined) cmd.push("--channel", base);
      cmd.push(root, path);
      run(cmd, root);
      writeFileSync(join(path, CLONE_MARKER), JSON.stringify({ root, branch }));
    },

    async removeWorkspace({ root: _root, path }) {
      const marker = markerAt(path);
      if (marker === null) {
        throw new Error(`no giwt-managed pijul clone at '${path}'. ${remedy()}`);
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}

export const pijulBackend: VcsBackend = makePijulBackend(defaultPijulSpawn);
