// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * commitlint config generator.
 *
 * Emits `.commitlint.yaml`. Conventional commits — subject ≤ 72 chars,
 * type-enum = feat|fix|refactor|chore|test|docs|style|perf|build|ci|revert.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const COMMITLINT_CONFIG = `# Commitlint configuration
# Conventional Commits — https://www.conventionalcommits.org/

rules:
  subject-max-length: [2, "always", 72]
  type-enum:
    - 2
    - "always"
    - ["feat", "fix", "refactor", "chore", "test", "docs", "style", "perf", "build", "ci", "revert"]
`;

export function generateCommitlint(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: ".commitlint.yaml", content: COMMITLINT_CONFIG }];
}
