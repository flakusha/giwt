// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * pijul finalize is commutation-based: recorded changes on the agent channel
 * are applied onto the base channel with `pijul apply`. No rebase, merge
 * commit, or ref CAS exists on this path. Gates run first; a failed gate
 * performs no pijul mutation at all.
 */

import { changeHashes, defaultPijulSpawn, type PijulSpawn } from "../../vcs/pijul";

const BASE_CHANNEL = "main";

export interface FinalizeWithPijulOptions {
  /** Repository (or agent clone) root holding the recorded channel. */
  root: string;
  branch: string;
  spawn?: PijulSpawn;
  runGates: () => void | Promise<void>;
}

export interface PijulFinalizeSummary {
  backend: "pijul";
  branch: string;
  channel: string;
  applied: string[];
}

export async function finalizeWithPijulCommutation({
  root,
  branch,
  spawn = defaultPijulSpawn,
  runGates,
}: FinalizeWithPijulOptions): Promise<PijulFinalizeSummary> {
  const run = (args: string[]): string => {
    const result = spawn(["pijul", ...args], root);
    if (result.exitCode !== 0) {
      throw new Error(
        `pijul ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
      );
    }
    return result.stdout.trim();
  };

  await runGates();

  const hashesFor = (channel: string): Set<string> =>
    changeHashes(run(["log", "--hash-only", "--output-format", "json", "--channel", channel]));
  const own = hashesFor(branch);
  const base = hashesFor(BASE_CHANNEL);
  const applied: string[] = [];
  // pijul log lists newest first; apply dependencies before their children.
  // ponytail: O(n) applies one change at a time; batch when pijul gains a multi-hash apply.
  for (const hash of [...own].reverse()) {
    if (base.has(hash)) continue;
    run(["apply", hash, "--channel", BASE_CHANNEL]);
    applied.push(hash);
  }
  return { backend: "pijul", branch, channel: BASE_CHANNEL, applied };
}
