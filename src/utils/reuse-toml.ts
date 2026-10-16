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
  // TOML basic ("…") and literal ('…') strings both appear in REUSE.toml.
  const m = block.match(new RegExp(`^${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "m"));
  if (!m) return null;
  return m[1] ?? m[2] ?? "";
}

function extractStringArray(block: string, key: string): string[] {
  // The bracket body may span lines (multi-line TOML arrays).
  const m = block.match(new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m"));
  if (!m?.[1]) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
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

/** Parse one header line's tag value, stripping the comment style's closing
 * delimiter (e.g. `-->` for markdown) only when the line actually ends with
 * it — `//` and `#` headers have no suffix and parse as-is. */
function parseTagValue(line: string, tag: string, suffix: string): string | null {
  const value = line.split(tag)[1];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return suffix !== "" && trimmed.endsWith(suffix)
    ? trimmed.slice(0, -suffix.length).trim()
    : trimmed;
}

/**
 * Rule selection among the rules of ONE REUSE.toml whose matchers hit `rel`.
 * An `override`-precedence rule beats `aggregate` rules (the last override in
 * file order wins among overrides); with no overrides, the first matching rule
 * in file order wins. This is the single selection policy for both header
 * validation (giwt spdx-check) and generated-file headers (generatedHeader).
 */
export function selectRule(rules: ReuseRule[], rel: string): ReuseRule | undefined {
  const matching = rules.filter((r) => r.matchers.some((m) => m.test(rel)));
  return matching.filter((r) => r.precedence === "override").pop() ?? matching[0];
}

/** Lines scanned for SPDX tokens after shebang/frontmatter stripping. */
const HEADER_SCAN_LINES = 20;

/**
 * The header region of a file: everything after an optional shebang line and
 * an optional YAML frontmatter block, limited to the first
 * {@linkcode HEADER_SCAN_LINES} lines. SPDX tokens count as a header only
 * inside this region — a token buried in the body is not a header.
 */
export function headerRegion(content: string): string {
  const lines = content.split("\n");
  let start = 0;
  if (lines[0]?.startsWith("#!")) start = 1;
  if (lines[start] === "---") {
    const end = lines.indexOf("---", start + 1);
    if (end !== -1) start = end + 1;
  }
  return lines.slice(start, start + HEADER_SCAN_LINES).join("\n");
}

export function checkHeader(content: string, rule: ReuseRule, ext = ""): HeaderCheck {
  const lines = headerRegion(content).split("\n");
  const licenseLine = lines.find((l) => l.includes("SPDX-License-Identifier:"));
  const copyrightLine = lines.find((l) => l.includes("SPDX-FileCopyrightText:"));
  const { suffix } = commentStyleFor(ext);
  const license = licenseLine === undefined
    ? null
    : parseTagValue(licenseLine, "SPDX-License-Identifier:", suffix);
  const copyright = copyrightLine === undefined
    ? null
    : parseTagValue(copyrightLine, "SPDX-FileCopyrightText:", suffix);
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
 * REUSE.toml. When several rules in that REUSE.toml match, selection follows
 * {@linkcode selectRule}: an `override`-precedence rule beats `aggregate`
 * rules (last override in file order wins), otherwise first match in file
 * order. Decision ticket: FEAT-reuse-toml-precedence-override-semantics-decision
 * (Option A — precedence honored, chosen over documenting first-match-final).
 */
export function generatedHeader(absPath: string, ext: string): string {
  const target = resolve(absPath);
  let dir = dirname(target);
  for (;;) {
    const toml = join(dir, "REUSE.toml");
    if (existsSync(toml)) {
      const rel = relative(dir, target).split(sep).join("/");
      const rule = selectRule(parseReuseToml(readFileSync(toml, "utf8")), rel);
      if (!rule || !rule.license || !rule.copyright) return "";
      return buildHeader(rule, ext);
    }
    const parent = dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
}
