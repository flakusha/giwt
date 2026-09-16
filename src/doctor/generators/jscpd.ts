// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * jscpd config generator.
 *
 * Emits `.jscpd.json` with permissive threshold + sensible ignore patterns.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const JSCPD_CONFIG = {
  threshold: 50,
  minLines: 5,
  minTokens: 50,
  ignore: [
    "**/*.test.ts",
    "**/migrations/**",
    "**/*.d.ts",
    "**/dist/**",
    "**/.tmp/**",
  ],
} as const;

export function generateJscpd(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: ".jscpd.json",
      content: JSON.stringify(JSCPD_CONFIG, null, 2) + "\n",
    },
  ];
}
