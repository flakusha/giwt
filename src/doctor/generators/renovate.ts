// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * renovate config generator.
 *
 * Emits `renovate.json`. devDependencies auto-merge; runtime dependencies
 * batched weekly Monday morning.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const RENOVATE_CONFIG = {
  extends: ["config:base"],
  packageRules: [
    {
      matchDepTypes: ["devDependencies"],
      automerge: true,
    },
    {
      matchDepTypes: ["dependencies"],
      automerge: false,
      schedule: ["before 6am on monday"],
    },
  ],
} as const;

export function generateRenovate(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: "renovate.json",
      content: JSON.stringify(RENOVATE_CONFIG, null, 2) + "\n",
    },
  ];
}
