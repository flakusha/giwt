// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Prettier config generator.
 *
 * Emits `.prettierrc.json` and `.prettierignore`.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const PRETTIER_CONFIG = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
} as const;

const PRETTIER_IGNORE = `# Prettier ignore
node_modules/
dist/
build/
.tmp/
.cache/
coverage/
bun.lock
bun.lockb
*.log
.DS_Store
`;

export function generatePrettier(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: ".prettierrc.json",
      content: JSON.stringify(PRETTIER_CONFIG, null, 2) + "\n",
    },
    { path: ".prettierignore", content: PRETTIER_IGNORE },
  ];
}
