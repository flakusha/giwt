// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * dprint config generator.
 *
 * Emits `dprint.json`. Plugin URLs match loop-lore pin set.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const DPRINT_CONFIG = {
  $schema: "https://dprint.dev/schemas/v0.json",
  indentWidth: 2,
  lineWidth: 100,
  excludes: [
    "bun.lock",
    "*.lock",
    ".env",
    "**/node_modules/**",
    "**/dist/**",
    "**/.tmp/**",
    "**/tree/",
  ],
  plugins: [
    "https://plugins.dprint.dev/typescript-0.96.1.wasm",
    "https://plugins.dprint.dev/json-0.23.0.wasm",
    "https://plugins.dprint.dev/markdown-0.22.1.wasm",
  ],
} as const;

export function generateDprint(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: "dprint.json",
      content: JSON.stringify(DPRINT_CONFIG, null, 2) + "\n",
    },
  ];
}
