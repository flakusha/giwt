// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * .editorconfig generator.
 *
 * Root-level config — 2-space indent, LF, UTF-8, trim trailing whitespace,
 * final newline. Markdown disables trim-trailing-whitespace (line breaks
 * are meaningful there).
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const EDITORCONFIG = `# EditorConfig — https://editorconfig.org
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[*.{yml,yaml}]
indent_size = 2
`;

export function generateEditorconfig(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: ".editorconfig", content: EDITORCONFIG }];
}
