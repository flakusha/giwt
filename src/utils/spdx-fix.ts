// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * SPDX header application (--fix): builds the header block for a rule +
 * extension and rewrites files in place, preserving shebangs and YAML
 * frontmatter.
 */
import { parseLicenses, type ReuseRule } from "./reuse-toml";

function commentStyleFor(ext: string): { prefix: string; suffix: string; } {
  switch (ext) {
    case ".html":
    case ".md":
    case ".mdx":
      return { prefix: "<!--", suffix: "-->" };
    case ".css":
      return { prefix: "/*", suffix: "*/" };
    default:
      return { prefix: "//", suffix: "" };
  }
}

function buildHeader(rule: ReuseRule, ext: string): string {
  const license = parseLicenses(rule.license)[0];
  const tags = [
    `SPDX-License-Identifier: ${license}`,
    `SPDX-FileCopyrightText: ${rule.copyright}`,
  ];
  if (ext === ".css") return `/* ${tags.join("\n * ")} */\n`;
  const { prefix, suffix } = commentStyleFor(ext);
  return tags.map((t) => `${prefix} ${t}${suffix}`).join("\n") + "\n";
}

function applyHeader(content: string, header: string): string {
  const lines = content.split("\n");
  let shebang = "";
  let start = 0;
  if (lines[0]?.startsWith("#!")) {
    shebang = lines[0];
    start = 1;
  }

  let frontmatter = "";
  if (lines[start] === "---") {
    const end = lines.indexOf("---", start + 1);
    if (end !== -1) {
      frontmatter = lines.slice(start, end + 1).join("\n") + "\n";
      start = end + 1;
    }
  }

  const spdxTag = /SPDX-License-Identifier:|SPDX-FileCopyrightText:/;
  const blockDelimiter = /^\s*(\/\*|\*\/)\s*$/;
  let i = start;
  if (lines.slice(i, i + 20).some((l) => spdxTag.test(l))) {
    while (
      i < lines.length
      && i < start + 20
      && (lines[i]?.trim() === "" || spdxTag.test(lines[i] ?? "")
        || blockDelimiter.test(lines[i] ?? ""))
    ) {
      i++;
    }
  }

  const rest = lines.slice(i).join("\n");
  let head = "";
  if (shebang) head += `${shebang}\n`;
  if (frontmatter) head += frontmatter;
  return head + header + rest;
}

/** Apply headers to a list of files, rewriting only those that change. */
export async function fixFiles(files: string[], rules: ReuseRule[]): Promise<number> {
  let fixed = 0;
  for (const file of files) {
    const content = await Bun.file(file).text();
    const ext = file.slice(file.lastIndexOf("."));
    const rule = rules.find((r) => r.matchers.some((m) => m.test(file)));
    if (!rule) continue;
    const next = applyHeader(content, buildHeader(rule, ext));
    if (next !== content) {
      await Bun.write(file, next);
      fixed++;
    }
  }
  return fixed;
}
