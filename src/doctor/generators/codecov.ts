// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * codecov config generator.
 *
 * Emits `codecov.yml` (YAML at root) plus a stub GitHub Actions workflow.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const CODECOV_CONFIG = `# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 giwt Contributors
# https://docs.codecov.com/docs/codecov-yaml
codecov:
  require_ci_to_pass: true
  coverage:
    status:
      project:
        default:
          target: 80%
      patch: false
`;

const CODECOV_WORKFLOW = `# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 giwt Contributors
name: Codecov

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  codecov:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bun/install@v1
      - run: bun test --coverage
      - uses: codecov/codecov-action@v4
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
`;

export function generateCodecov(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    { path: "codecov.yml", content: CODECOV_CONFIG },
    { path: ".github/workflows/codecov.yml", content: CODECOV_WORKFLOW },
  ];
}
