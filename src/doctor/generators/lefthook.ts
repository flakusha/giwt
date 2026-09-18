// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * lefthook config generator.
 *
 * Emits `lefthook.yml` — fast cross-language hook runner, an alternative to
 * .githooks/. Opt-in only (`--tool lefthook`): .githooks/ stays the default
 * for bun/TS projects. Mirrors the staged-file checks of .githooks/pre-commit.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const LEFTHOOK_CONFIG = `# lefthook — fast hook runner
# https://github.com/evilmartians/lefthook
# Install: bunx lefthook install (or brew install lefthook)

pre-commit:
  parallel: true
  commands:
    fmt:
      glob: "*.{ts,tsx,js,jsx,json,md,toml}"
      run: dprint fmt -- {staged_files} && git add {staged_files}
    lint:
      glob: "*.{ts,tsx}"
      run: oxlint --no-error-on-unmatched-pattern {staged_files}
`;

export function generateLefthook(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: "lefthook.yml", content: LEFTHOOK_CONFIG }];
}
