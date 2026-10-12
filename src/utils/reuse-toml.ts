// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * REUSE.toml parsing and SPDX header validation.
 *
 * Parses [[annotations]] blocks, converts path globs to regex matchers, and
 * validates that a file's first-line SPDX-License-Identifier matches the rule
 * for its path.
 */

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

/** Parse REUSE.toml into an ordered list of rules. */
export function parseReuseToml(content: string): ReuseRule[] {
  const rules: ReuseRule[] = [];
  const blocks = content.split(/(?=\[\[annotations\]\])/);
  for (const block of blocks) {
    if (!block.startsWith("[[annotations]]")) continue;
    const paths = extractStringArray(block, "paths");
    const license = extractString(block, "license") ?? "";
    const copyright = extractString(block, "copyright") ?? "";
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
