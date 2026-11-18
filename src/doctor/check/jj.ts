// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `jj` / `pijul` doctor checks — read-only probes of the configured VCS
 * backend. Both are skipped for other backends (git needs neither binary).
 * Findings are errors: the check fails when the binary is absent, too old,
 * or (for jj) the repo is not colocated with git.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  meetsVersionFloor,
  parsePijulVersion,
  type PijulVersion,
} from "../../intercom/backend-pijul.ts";
import { WORKSPACE_TEMPLATE } from "../../vcs/jj.ts";
import { PIJUL_PINNED_VERSION } from "../../vcs/pijul.ts";
import type { VcsBackendName } from "../../vcs/types.ts";
import type { SpawnFn } from "./spawn.ts";
import type { CheckFinding, CheckResult } from "./types.ts";

/** Child-workspace colocation requires jj 0.46+ (see jj support ticket). */
export const JJ_VERSION_FLOOR = "0.46.0";
const COLOCATED = "is currently colocated with Git.";

/** Version comparators shared with the pijul intercom backend. */
export function parseJjVersion(output: string): PijulVersion | null {
  const m = /\bjj\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0), beta: null };
}

function show(v: PijulVersion): string {
  return `${v.major}.${v.minor}.${v.patch}${v.beta === null ? "" : `-beta.${v.beta}`}`;
}

function finding(rule: string, message: string): CheckFinding {
  return { file: "giwt.toml", line: 0, rule, message, severity: "error", kind: "task" };
}

/** Read-only dev-sync sweep: `jj workspace list -T` prints name|path; report
 *  entries whose checkout directory has disappeared (no mutation). */
async function staleWorkspaceFinding(
  spawn: SpawnFn,
  root: string,
): Promise<CheckFinding | null> {
  const listing = await probe(
    spawn,
    ["jj", "workspace", "list", "--no-pager", "-T", WORKSPACE_TEMPLATE],
    root,
  );
  if (listing === null) return null;
  const stale: string[] = [];
  for (const line of listing.split("\n")) {
    const sep = line.indexOf("|");
    if (sep < 0) continue;
    const name = line.slice(0, sep).trim();
    const path = line.slice(sep + 1).trim();
    if (name === "" || path === "" || existsSync(resolve(root, path))) continue;
    stale.push(`${name} (${path})`);
  }
  if (stale.length === 0) return null;
  return finding(
    "jj-stale-workspace",
    `jj workspace(s) missing on disk: ${
      stale.join(", ")
    } — run 'jj workspace forget <name>' to drop stale entries`,
  );
}

export interface VcsCheckOptions {
  root: string;
  vcsBackend: VcsBackendName;
  spawn: SpawnFn;
}

/** Successful stdout, or null when the binary is missing/the command failed. */
async function probe(spawn: SpawnFn, cmd: string[], cwd: string): Promise<string | null> {
  try {
    const res = await spawn(cmd, cwd);
    return res.exitCode === 0 ? res.stdout : null;
  } catch {
    return null;
  }
}

/** Check the configured backend; skipped when it is not `id`. */
export async function runVcsCheck(
  id: "jj" | "pijul",
  opts: VcsCheckOptions,
): Promise<CheckResult> {
  if (opts.vcsBackend !== id) {
    return {
      id,
      tool: `${id} --version`,
      ok: true,
      skipped: `vcs backend is '${opts.vcsBackend}' (requires '${id}')`,
      findings: [],
    };
  }
  const findings: CheckFinding[] = [];
  const notes: string[] = [];
  const versionOut = await probe(opts.spawn, [id, "--version"], opts.root);
  if (versionOut === null) {
    findings.push(
      finding(
        `${id}-binary`,
        `'${id}' not found on PATH — install ${id} or set [vcs] backend = "git"`,
      ),
    );
  } else if (id === "jj") {
    const version = parseJjVersion(versionOut);
    const floor = parseJjVersion(`jj ${JJ_VERSION_FLOOR}`)!;
    notes.push(`jj version floor >= ${JJ_VERSION_FLOOR}; colocated with git required`);
    if (version === null) {
      findings.push(
        finding("jj-version", `cannot parse 'jj --version' output: ${versionOut.trim()}`),
      );
    } else if (!meetsVersionFloor(version, floor)) {
      findings.push(finding(
        "jj-version",
        `jj ${show(version)} is too old — need >= ${JJ_VERSION_FLOOR}`,
      ));
    }
    const colocation = await probe(opts.spawn, ["jj", "git", "colocation", "status"], opts.root);
    if (colocation === null) {
      findings.push(
        finding("jj-colocation", "cannot run 'jj git colocation status' — colocation is required"),
      );
    } else if (!colocation.includes(COLOCATED)) {
      findings.push(
        finding(
          "jj-colocation",
          "jj repo is not colocated with git — giwt config requires colocation",
        ),
      );
    }
    const stale = await staleWorkspaceFinding(opts.spawn, opts.root);
    if (stale !== null) findings.push(stale);
  } else {
    const version = parsePijulVersion(versionOut);
    notes.push(`pijul version pinned to ${PIJUL_PINNED_VERSION}`);
    if (version === null) {
      findings.push(
        finding("pijul-version", `cannot parse 'pijul --version' output: ${versionOut.trim()}`),
      );
    } else if (show(version) !== PIJUL_PINNED_VERSION) {
      findings.push(finding(
        "pijul-version",
        `pijul ${show(version)} is unsupported — need exactly ${PIJUL_PINNED_VERSION}`,
      ));
    }
  }
  return { id, tool: `${id} --version`, ok: findings.length === 0, findings, notes };
}
