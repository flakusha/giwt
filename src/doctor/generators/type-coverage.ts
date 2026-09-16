// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * type-coverage config generator.
 *
 * Emits `type-coverage.json`. Strict mode + 95% global / 90% per-file.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const TYPE_COVERAGE_CONFIG = {
  threshold: { global: 95, perFile: 90 },
  strict: true,
  ignoreFiles: ["**/*.test.ts"],
} as const;

export function generateTypeCoverage(
  _ctx: GeneratorContext,
): GeneratedFile[] {
  return [
    {
      path: "type-coverage.json",
      content: JSON.stringify(TYPE_COVERAGE_CONFIG, null, 2) + "\n",
    },
  ];
}
