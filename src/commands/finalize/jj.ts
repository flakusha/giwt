// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * jj finalize is op-log-centered: capture an op before gates, revert to it if
 * a gate fails, and move the bookmark only after a green gate run. giwt's own
 * bounded gate pool is the gate substrate — never `jj run`.
 */

import { defaultJjSpawn, type JjSpawn } from "../../vcs/jj";

export interface FinalizeWithJjOptions {
  root: string;
  branch: string;
  /** --onto target, recorded for observability; jj keeps its own graph. */
  ontop?: string;
  spawn?: JjSpawn;
  runGates: () => void | Promise<void>;
}

export interface JjFinalizeSummary {
  backend: "jj";
  branch: string;
  opId: string;
  ontop: string;
  bookmark: string;
  reverted: boolean;
}

export async function finalizeWithJjOpLog({
  root,
  branch,
  ontop = "",
  spawn = defaultJjSpawn,
  runGates,
}: FinalizeWithJjOptions): Promise<JjFinalizeSummary> {
  const run = (args: string[]): string => {
    const result = spawn(["jj", ...args], root);
    if (result.exitCode !== 0) {
      throw new Error(
        `jj ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
      );
    }
    return result.stdout.trim();
  };

  const opId = run(["op", "log", "-n", "1", "-T", "id"]);
  if (opId === "") {
    throw new Error(
      "jj op log returned no operation id; refusing to finalize without a rollback point",
    );
  }

  try {
    await runGates();
  } catch (gateError) {
    const revert = spawn(["jj", "op", "revert", "--op", opId], root);
    if (revert.exitCode !== 0) {
      throw new Error(
        `gates failed and jj op revert --op ${opId} also failed (exit ${revert.exitCode}): `
          + `${revert.stderr.trim()}; original failure: ${String(gateError)}`,
      );
    }
    throw gateError;
  }

  run(["bookmark", "set", branch, "-r", "@"]);
  return { backend: "jj", branch, opId, ontop, bookmark: branch, reverted: false };
}
