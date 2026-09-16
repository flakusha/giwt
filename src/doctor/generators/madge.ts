// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * madge config generator.
 *
 * Emits `madge.config.cjs` (CommonJS so it works in both ESM and CJS projects).
 * Detects circular dependencies for .ts sources via the project's tsconfig.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const MADGE_CONFIG_CJS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// madge — circular dependency + module graph analyser
// https://github.com/pahen/madge

module.exports = {
  fileExtensions: ["ts"],
  tsConfig: "tsconfig.json",
  circular: true,
  detectiveOptions: {
    ts: {
      skipTypeImports: true,
    },
  },
};
`;

export function generateMadge(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: "madge.config.cjs", content: MADGE_CONFIG_CJS }];
}
