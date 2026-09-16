// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Changesets config generator.
 *
 * Emits `.changeset/config.json` (uses the @changesets/cli default changelog
 * generator) plus a stub README.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const CHANGESET_CONFIG = {
  changelog: ["@changesets/cli/changelog"],
  commit: false,
  fixed: [] as readonly string[],
  baseBranch: "main",
  updateInternalDependencies: "patch",
} as const;

const CHANGESET_README = `# Changesets

Add a changeset with \`bunx changeset\` — describes user-visible
changes; \`@changesets/cli\` assembles them into CHANGELOG.md on release.
`;

export function generateChangesets(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: ".changeset/config.json",
      content: JSON.stringify(CHANGESET_CONFIG, null, 2) + "\n",
    },
    { path: ".changeset/README.md", content: CHANGESET_README },
  ];
}
