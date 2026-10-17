#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Command registry: `src/cli.ts` builds the Optique parser/dispatch from
 * this table (keys match src/commands/<key>.ts). The Record itself lives in
 * ./cli-commands (split for the file-size budget, mirroring the settings
 * split); this module stays the public import surface.
 */

import type { WorktreeConfig } from "./utils/config";

export { commands } from "./cli-commands";

/** One giwt subcommand. */
export interface CommandHandler {
  description: string;
  run: (args: string[], config: WorktreeConfig) => Promise<void>;
}
