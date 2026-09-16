// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * typedoc config generator.
 *
 * Emits `typedoc.json`. Entry: src/index.ts; output: docs/api.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const TYPEDOC_CONFIG = {
  entryPoints: ["src/index.ts"],
  out: "docs/api",
  includeVersion: true,
  excludePrivate: true,
} as const;

export function generateTypedoc(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: "typedoc.json",
      content: JSON.stringify(TYPEDOC_CONFIG, null, 2) + "\n",
    },
  ];
}
