// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * dependabot config generator.
 *
 * Emits `.github/dependabot.yml`. Weekly updates for npm + github-actions.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const DEPENDABOT_CONFIG = `# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 giwt Contributors
# https://docs.github.com/en/code-security/dependabot/dependabot-version-updates
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
`;

export function generateDependabot(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: ".github/dependabot.yml",
      content: DEPENDABOT_CONFIG,
    },
  ];
}
