// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Jujutsu backend for the VCS primitive seam. jj-only: every spawn has `jj`
 * as argv[0], and there is no git fallback. Version and colocation guards
 * fail closed with an actionable refusal on every distinct root.
 */

import { type VcsBackend, vcsBackendRemedy, type VcsBranch, type VcsWorkspace } from "./types";

/** Result of one jj CLI invocation. */
export interface JjResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable jj CLI seam. `cmd` always starts with `jj`, never `git`. */
export type JjSpawn = (cmd: string[], cwd: string) => JjResult;

const JJ = "jj";
export const BOOKMARK_TEMPLATE =
  "name ++ \"|\" ++ present ++ \"|\" ++ conflict ++ \"|\" ++ normal_target.commit_id() ++ \"\\n\"";
export const WORKSPACE_TEMPLATE = "name ++ \"|\" ++ root ++ \"\\n\"";
export const COUNT_TEMPLATE = "\"x\"";
const COLOCATED = /is currently colocated with Git\./;

export const defaultJjSpawn: JjSpawn = (cmd, cwd) => {
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

/** Build a backend around an injected jj spawn seam (tests inject a stub). */
export function makeJjBackend(spawn: JjSpawn): VcsBackend {
  const exec = (cmd: string[], cwd: string): JjResult => spawn([JJ, ...cmd], cwd);

  const fail = (cmd: string[], result: JjResult): never => {
    throw new Error(
      `jj ${cmd.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.trim()}. `
        + vcsBackendRemedy("jj"),
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
        const parsed = /(\d+)\.(\d+)\.(\d+)/.exec(version.stdout);
        if (parsed === null) {
          throw new Error(
            `cannot parse jj version '${version.stdout.trim()}' (need >= 0.46). `
              + vcsBackendRemedy("jj"),
          );
        }
        const major = Number(parsed[1]);
        const minor = Number(parsed[2]);
        if (major === 0 && minor < 46) {
          throw new Error(
            `jj ${major}.${minor} is too old (need >= 0.46). ${vcsBackendRemedy("jj")}`,
          );
        }
        const coloc = exec(["git", "colocation", "status"], cwd);
        if (coloc.exitCode !== 0) fail(["git", "colocation", "status"], coloc);
        if (!COLOCATED.test(coloc.stdout)) {
          throw new Error(`jj workspace is not colocated with Git. ${vcsBackendRemedy("jj")}`);
        }
      })();
      guards.set(cwd, pending);
    }
    return pending;
  };

  /** Resolve the base revset: trunk() when a remote provides it, else a local
   * main/master bookmark, else the root commit. */
  const baseRev = (cwd: string): string => {
    const trunk = exec(["log", "-r", "trunk()", "--no-graph", "-T", "commit_id"], cwd);
    const id = trunk.stdout.trim();
    if (trunk.exitCode === 0 && /[1-9a-f]/.test(id)) return "trunk()";
    for (const name of ["main", "master"]) {
      const probe = exec(["log", "-r", name, "--no-graph", "-T", "commit_id"], cwd);
      if (probe.exitCode === 0 && probe.stdout.trim() !== "") return name;
    }
    return "root()";
  };

  const count = (cwd: string, revset: string): number =>
    run(["log", "-r", revset, "--no-graph", "-T", COUNT_TEMPLATE], cwd).length;

  return {
    name: "jj",

    async listBranches(root) {
      await guard(root);
      const listing = run(["bookmark", "list", "--no-pager", "-T", BOOKMARK_TEMPLATE], root);
      const currentId = run(["log", "-r", "@", "--no-graph", "-T", "commit_id"], root);
      const branches: VcsBranch[] = [];
      for (const line of listing.split("\n")) {
        const [name, present, conflict, target] = line.split("|");
        if (name === undefined || present !== "true") continue;
        branches.push({ name, current: conflict === "false" && target === currentId });
      }
      return branches;
    },

    async listWorkspaces(root) {
      await guard(root);
      const listing = run(["workspace", "list", "--no-pager", "-T", WORKSPACE_TEMPLATE], root);
      const workspaces: VcsWorkspace[] = [];
      for (const line of listing.split("\n")) {
        const [name, path] = line.split("|");
        if (name === undefined) continue;
        workspaces.push({ path: path ?? "", branch: "" });
      }
      return workspaces;
    },

    async status(root, branch) {
      await guard(root);
      const base = baseRev(root);
      return {
        branch,
        ahead: count(root, `${base}..@`),
        behind: count(root, `@..${base}`),
        clean: run(["diff", "--name-only"], root) === "",
      };
    },

    async diff(root, branch) {
      await guard(root);
      const out = run(["diff", "--from", branch, "--name-only"], root);
      return out === ""
        ? []
        : out.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    },

    async commit({ cwd, message }) {
      await guard(cwd);
      run(["commit", "-m", message], cwd);
      return { sha: run(["log", "-r", "@-", "--no-graph", "-T", "commit_id"], cwd) };
    },

    async createWorkspace({ root, path, branch, base }) {
      await guard(root);
      const cmd = ["workspace", "add", path, "--name", branch];
      if (base !== undefined) cmd.push("--revision", base);
      run(cmd, root);
      run(["bookmark", "create", branch], root);
    },

    async removeWorkspace({ root, path }) {
      await guard(root);
      const listing = run(["workspace", "list", "--no-pager", "-T", WORKSPACE_TEMPLATE], root);
      let name: string | undefined;
      for (const line of listing.split("\n")) {
        const [entry, entryPath] = line.split("|");
        if (entry !== undefined && entryPath === path) {
          name = entry;
          break;
        }
      }
      if (name === undefined) {
        throw new Error(`no jj workspace found at '${path}'. ${vcsBackendRemedy("jj")}`);
      }
      run(["workspace", "forget", name], root);
    },
  };
}

export const jjBackend: VcsBackend = makeJjBackend(defaultJjSpawn);
