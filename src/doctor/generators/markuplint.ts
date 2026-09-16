// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * markuplint config generator.
 *
 * Emits `.markuplintrc.json` extending the HTML spec.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const MARKUPLINT_CONFIG = {
  extends: ["@markuplint/html-spec"],
  rules: {},
} as const;

export function generateMarkuplint(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: ".markuplintrc.json",
      content: JSON.stringify(MARKUPLINT_CONFIG, null, 2) + "\n",
    },
  ];
}
