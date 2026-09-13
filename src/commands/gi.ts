// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import type { WorktreeConfig } from "../utils/config";
import { gitSync } from "../utils/git";
import { raw } from "../utils/output";

export async function gi(args: string[], config: WorktreeConfig): Promise<void> {
  const repoRoot = config.repoRoot;
  const output = gitSync(repoRoot, "issue", ...args);
  raw(output);
}
