// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * ruff config generator.
 *
 * Emits `ruff.toml`. Line length 100, Python 3.10, E/F/I/N/W rules;
 * E501 ignored because line length is enforced separately.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const RUFF_CONFIG = `# ruff — https://docs.astral.sh/ruff/
line-length = 100
target-version = "py310"

[lint]
select = ["E", "F", "I", "N", "W"]
ignore = ["E501"]
`;

export function generateRuff(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: "ruff.toml", content: RUFF_CONFIG }];
}
