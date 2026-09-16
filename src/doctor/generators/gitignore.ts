// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * .gitignore generator.
 *
 * Emits a comprehensive baseline (Node, build artifacts, env, IDEs, agent
 * scratch dirs) and conditionally appends language-specific ignores based
 * on `ctx.report.languages` (Rust target/, Python .venv/, etc.).
 */

import type { Language } from "../detect.ts";
import type { GeneratedFile, GeneratorContext } from "../types.ts";

const BASE_LINES: readonly string[] = [
  "# Node",
  "node_modules/",
  "",
  "# Build / runtime",
  "dist/",
  "build/",
  ".tmp/",
  ".cache/",
  "coverage/",
  "",
  "# Logs",
  "*.log",
  "",
  "# Databases",
  "*.db",
  "*.db-wal",
  "*.db-shm",
  "",
  "# Env",
  ".env",
  ".env.local",
  ".env.*.local",
  "",
  "# Bun / lockfiles",
  "bun.lockb",
  "",
  "# OS",
  ".DS_Store",
  "",
  "# IDE",
  ".idea/",
  ".vscode/",
  "",
  "# Agent scratch dirs",
  ".serena/",
  ".hermes/",
  ".opencode/",
  ".playwright-mcp/",
];

const LANGUAGE_IGNORES: Record<Language, readonly string[]> = {
  typescript: [],
  javascript: [],
  rust: ["# Rust", "target/", "**/*.rs.bk"],
  shell: [],
  markdown: [],
  html: [],
  css: [],
  python: ["# Python", ".venv/", "__pycache__/", "*.pyc", ".pytest_cache/", ".mypy_cache/"],
  go: ["# Go", "vendor/"],
};

export function generateGitignore(ctx: GeneratorContext): GeneratedFile[] {
  const lines: string[] = [...BASE_LINES];

  for (const lang of ctx.report.languages) {
    const extras = LANGUAGE_IGNORES[lang];
    if (extras.length > 0) {
      lines.push("", ...extras);
    }
  }

  lines.push("");
  return [{ path: ".gitignore", content: lines.join("\n") }];
}
