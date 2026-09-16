// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * remark config generator.
 *
 * Emits `remark.config.mjs` (ESM). Minimal stub wiring remark-lint to the
 * Google markdown style guide preset.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const REMARK_CONFIG_MJS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// remark — unified markdown linter pipeline
// https://github.com/remarkjs/remark

import remark from "remark";
import remarkLint from "remark-lint";
import remarkPresetLintMarkdownStyleGuide from "remark-preset-lint-markdown-style-guide";

const config = {
  plugins: [
    remarkLint,
    [remarkPresetLintMarkdownStyleGuide, {}],
  ],
};

export default config;
`;

export function generateRemark(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: "remark.config.mjs", content: REMARK_CONFIG_MJS }];
}
