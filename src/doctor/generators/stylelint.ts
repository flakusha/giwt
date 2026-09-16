// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * stylelint config generator.
 *
 * Emits `.stylelintrc.json` with `stylelint-config-standard` and permissive
 * selector/custom-property patterns (CSS-in-JS friendly).
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const STYLELINT_CONFIG = {
  extends: ["stylelint-config-standard"],
  rules: {
    "selector-class-pattern": null,
    "custom-property-pattern": null,
  },
} as const;

export function generateStylelint(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: ".stylelintrc.json",
      content: JSON.stringify(STYLELINT_CONFIG, null, 2) + "\n",
    },
  ];
}
