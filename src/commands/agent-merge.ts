// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Agent merge — alias for finalize
 */

import type { WorktreeConfig } from "../utils/config";
import { finalize } from "./finalize";

export async function agentMerge(
  args: string[],
  config: WorktreeConfig,
): Promise<void> {
  return finalize(args, config);
}
