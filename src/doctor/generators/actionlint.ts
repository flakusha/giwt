// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * actionlint config generator.
 *
 * actionlint has no required config file; options come from CLI flags
 * or env. We emit a placeholder `.github/actionlint.yaml` so projects
 * can override defaults (e.g. `self-hosted-runner.labels`).
 *
 * https://github.com/rhysd/actionlint
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const ACTIONLINT_NOTE = `# actionlint — GitHub Actions workflow linter
# https://github.com/rhysd/actionlint
#
# actionlint reads its config from this file when present (YAML).
# Uncomment overrides below to customise checks.
#
# self-hosted-runner:
#   labels: [self-hosted, linux, x64]
# config-variables: none
`;

export function generateActionlint(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    { path: ".github/actionlint.yaml", content: ACTIONLINT_NOTE },
  ];
}
