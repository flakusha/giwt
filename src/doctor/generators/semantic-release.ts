// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * semantic-release config generator.
 *
 * Emits `release.config.cjs` (CommonJS so the file works in both ESM and
 * CJS packages without `type: "module"` gymnastics).
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const RELEASE_CONFIG_CJS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// semantic-release — automated version + publish
// https://github.com/semantic-release/semantic-release

module.exports = {
  branches: ["main"],
  plugins: [
    ["@semantic-release/commit-analyzer"],
    ["@semantic-release/release-notes-generator"],
    ["@semantic-release/npm"],
    ["@semantic-release/github"],
  ],
};
`;

export function generateSemanticRelease(
  _ctx: GeneratorContext,
): GeneratedFile[] {
  return [{ path: "release.config.cjs", content: RELEASE_CONFIG_CJS }];
}
