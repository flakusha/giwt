// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * oxlint config generator.
 *
 * Emits `.oxlintrc.json` (JSON, NOT .ts — matches giwt convention).
 * Categories: correctness=error, suspicious=warn, perf=warn, style=warn.
 * Plugins: typescript, unicorn, import, oxc. env.builtin=true.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const IGNORE_PATTERNS: readonly string[] = [
  "dist/**",
  "node_modules/**",
  ".tmp/**",
  "tree/**",
  "bun.lock",
  "scripts/**",
  "data/**",
  "coverage/**",
  "*.test.ts",
];

const OXLINT_CONFIG = {
  $schema: "./node_modules/oxlint/configuration_schema.json",
  plugins: ["typescript", "unicorn", "import", "oxc"],
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
    style: "warn",
  },
  env: {
    builtin: true,
  },
  ignorePatterns: [...IGNORE_PATTERNS],
} as const;

export function generateOxlint(_ctx: GeneratorContext): GeneratedFile[] {
  const content = JSON.stringify(OXLINT_CONFIG, null, 2) + "\n";
  return [{ path: ".oxlintrc.json", content }];
}
