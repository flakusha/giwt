// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * markdownlint config generator.
 *
 * Emits `.markdownlint.json`. MD013 (line-length) disabled to match loop-lore.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const MARKDOWNLINT_CONFIG = {
  default: true,
  MD013: false,
} as const;

export function generateMarkdownlint(
  _ctx: GeneratorContext,
): GeneratedFile[] {
  return [
    {
      path: ".markdownlint.json",
      content: JSON.stringify(MARKDOWNLINT_CONFIG, null, 2) + "\n",
    },
  ];
}
