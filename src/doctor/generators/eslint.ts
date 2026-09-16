// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * ESLint config generator.
 *
 * Emits a minimal `eslint.config.mjs` stub. ESLint is kept minimal;
 * oxlint handles the bulk of the rules. This stub enables typescript-eslint
 * + unicorn for the rules oxlint cannot replicate.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const ESLINT_CONFIG_MJS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// ESLint flat config — minimal stub.
// ESLint kept minimal; oxlint handles most rules.
// ESLint is enabled ONLY for what oxlint cannot replicate:
//   - typescript-eslint type-aware rules
//   - unicorn rules oxlint lacks
//   - jsdoc tag validation
// https://eslint.org/docs/latest/use/configure/configuration-files

import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    plugins: { unicorn },
    rules: {
      ...unicorn.configs.recommended.rules,
    },
  },
);
`;

export function generateEslint(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: "eslint.config.mjs", content: ESLINT_CONFIG_MJS }];
}
