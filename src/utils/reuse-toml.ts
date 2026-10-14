// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * REUSE.toml parsing and SPDX header construction.
 *
 * Parses [[annotations]] blocks (legacy and REUSE-spec keys), converts path
 * globs to regex matchers, validates a file's SPDX header against the rule for
 * its path, builds the header block for a rule + extension, and resolves the
 * header a consuming repository wants stamped on generated files.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface ReuseRule {
  paths: string[];
  license: string;
  copyright: string;
  matchers: RegExp[];
  precedence: string;
}

/** Convert a REUSE.toml glob to a regex. Handles *, **, and literal paths. */
function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/(?<!\*)\*(?!\*)/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${pattern}$`);
}

function extractString(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return m?.[1] ?? null;
}

function extractStringArray(block: string, key: string): string[] {
  const m = block.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
  if (!m?.[1]) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

/** Paths for a block: legacy `paths` array or REUSE-spec `path` (string or array). */
function extractPaths(block: string): string[] {
  const legacy = extractStringArray(block, "paths");
  if (legacy.length > 0) return legacy;
  const single = extractString(block, "path");
  if (single !== null) return [single];
  return extractStringArray(block, "path");
}

/** Parse REUSE.toml into an ordered list of rules. Accepts legacy and spec keys. */
export function parseReuseToml(content: string): ReuseRule[] {
  const rules: ReuseRule[] = [];
  const blocks = content.split(/(?=\[\[annotations\]\])/);
  for (const block of blocks) {
    if (!block.startsWith("[[annotations]]")) continue;
    const paths = extractPaths(block);
    const license = extractString(block, "license")
      ?? extractString(block, "SPDX-License-Identifier")
      ?? "";
    const copyright = extractString(block, "copyright")
      ?? extractString(block, "SPDX-FileCopyrightText")
      ?? "";
    const precedence = extractString(block, "precedence") ?? "aggregate";
    if (paths.length === 0) continue;
    rules.push({ paths, license, copyright, matchers: paths.map(globToRegex), precedence });
  }
  return rules;
}

/** Extract license identifiers from an SPDX expression like "Apache-2.0 OR MIT". */
export function parseLicenses(expr: string): string[] {
  return expr.split(/\s+OR\s+/i).map((s) => s.trim()).filter(Boolean);
}

export interface HeaderCheck {
  valid: boolean;
  license: string | null;
  copyright: string | null;
  expectedLicense: string;
  expectedCopyright: string;
}

export function checkHeader(content: string, rule: ReuseRule): HeaderCheck {
  const lines = content.split("\n");
  const licenseLine = lines.find((l) => l.includes("SPDX-License-Identifier:"));
  const copyrightLine = lines.find((l) => l.includes("SPDX-FileCopyrightText:"));
  const license = licenseLine?.split("SPDX-License-Identifier:")[1]?.trim() ?? null;
  const copyright = copyrightLine?.split("SPDX-FileCopyrightText:")[1]?.trim() ?? null;
  const expectedLicense = parseLicenses(rule.license)[0] ?? rule.license;
  const valid = license === expectedLicense && copyright?.includes(rule.copyright) === true;
  return { valid, license, copyright, expectedLicense, expectedCopyright: rule.copyright };
}

/** Comment delimiters for an extension. */
export function commentStyleFor(ext: string): { prefix: string; suffix: string; } {
  switch (ext) {
    case ".html":
    case ".md":
    case ".mdx":
      return { prefix: "<!--", suffix: "-->" };
    case ".css":
      return { prefix: "/*", suffix: "*/" };
    case ".yml":
    case ".yaml":
    case ".toml":
      return { prefix: "#", suffix: "" };
    default:
      return { prefix: "//", suffix: "" };
  }
}

export function buildHeader(rule: ReuseRule, ext: string): string {
  const license = parseLicenses(rule.license)[0];
  const tags = [
    `SPDX-License-Identifier: ${license}`,
    `SPDX-FileCopyrightText: ${rule.copyright}`,
  ];
  if (ext === ".css") return `/* ${tags.join("\n * ")} */\n`;
  const { prefix, suffix } = commentStyleFor(ext);
  return tags.map((t) => `${prefix} ${t}${suffix}`).join("\n") + "\n";
}

/**
 * Header the nearest REUSE.toml wants on a generated file, or "" when the
 * consuming repo has no matching rule (or no REUSE.toml at all). Walks up from
 * the file's directory; the nearest REUSE.toml wins (parent rules are not
 * merged). Rule matchers are tested against the path relative to that
 * REUSE.toml.
 */
export function generatedHeader(absPath: string, ext: string): string {
  const target = resolve(absPath);
  let dir = dirname(target);
  for (;;) {
    const toml = join(dir, "REUSE.toml");
    if (existsSync(toml)) {
      const rel = relative(dir, target).split(sep).join("/");
      const rule = parseReuseToml(readFileSync(toml, "utf8"))
        .find((r) => r.matchers.some((m) => m.test(rel)));
      if (!rule || !rule.license || !rule.copyright) return "";
      return buildHeader(rule, ext);
    }
    const parent = dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}
