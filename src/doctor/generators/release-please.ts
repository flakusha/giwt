// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * release-please config generator.
 *
 * Emits `release-please-config.json` plus a stub `.github/workflows/release-please.yml`.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const RELEASE_PLEASE_CONFIG = {
  packages: {
    ".": {
      releaseType: "node",
    },
  },
  pullRequestTitlePattern: "chore${scope}: release${scope}",
  tagSeparator: "-",
} as const;

const RELEASE_PLEASE_WORKFLOW = `# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 giwt Contributors
name: Release Please

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
`;

export function generateReleasePlease(
  _ctx: GeneratorContext,
): GeneratedFile[] {
  return [
    {
      path: "release-please-config.json",
      content: JSON.stringify(RELEASE_PLEASE_CONFIG, null, 2) + "\n",
    },
    {
      path: ".github/workflows/release-please.yml",
      content: RELEASE_PLEASE_WORKFLOW,
    },
  ];
}
