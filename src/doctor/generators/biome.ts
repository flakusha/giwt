// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * biome config generator.
 *
 * Emits biome.json. Schema 1.9.0. Targets docs tree markdown for linting
 * and formatting; node_modules/dist/data/.tmp excluded.
 * Linter: noUnusedImports/noUnusedVariables=warn, useConst=error.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const BIOME_CONFIG = {
  $schema: "https://biomejs.dev/schemas/1.9.0/schema.json",
  files: {
    include: ["docs/**/*.md"],
    ignore: ["node_modules", "dist", "data", ".tmp"],
  },
  linter: {
    enabled: true,
    rules: {
      recommended: true,
      correctness: {
        noUnusedImports: "warn",
        noUnusedVariables: "warn",
      },
      style: {
        useConst: "error",
      },
    },
  },
  formatter: {
    enabled: true,
    indentStyle: "space",
    indentWidth: 2,
    lineWidth: 100,
  },
  markdown: {
    formatter: {
      lineWidth: 100,
      proseWrap: "preserve",
    },
  },
} as const;

export function generateBiome(_ctx: GeneratorContext): GeneratedFile[] {
  const content = JSON.stringify(BIOME_CONFIG, null, 2) + "\n";
  return [{ path: "biome.json", content }];
}
