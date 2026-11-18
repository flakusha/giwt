// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * jj has no current branch; the ledger/run-record branch field carries the
 * bookmark pinned on this workspace's `@` instead of any git branch name.
 */

import { gitSyncQuiet } from "../utils/git";
import { defaultJjSpawn, type JjSpawn, makeJjBackend } from "./jj";
import type { VcsBackendName } from "./types";

export async function currentJjBookmark({
  root,
  spawn = defaultJjSpawn,
}: {
  root: string;
  spawn?: JjSpawn;
}): Promise<string> {
  const branches = await makeJjBackend(spawn).listBranches(root);
  return branches.find((branch) => branch.current)?.name ?? "";
}

/** One resolver for the ledger/run-record branch; git mode keeps its exact probe. */
export async function evidenceBranch({
  root,
  backend,
  spawn,
}: {
  root: string;
  backend: VcsBackendName;
  spawn?: JjSpawn;
}): Promise<string> {
  if (backend === "jj") {
    return currentJjBookmark({ root, ...(spawn !== undefined ? { spawn } : {}) });
  }
  return gitSyncQuiet(root, "branch", "--show-current");
}
