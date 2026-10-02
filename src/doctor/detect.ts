// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Project structure detection for `giwt doctor`.
 *
 * Pure FS scan over a project root. Returns a structured report — no side
 * effects, no spawning. Caller decides what to recommend.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectGitHygiene } from "./detect/git.ts";
import { detectLicense } from "./detect/license.ts";
import {
  inferPackageManager,
  inferRuntimes,
  listLockfiles,
  readPackageJson,
} from "./detect/pkg.ts";
import { walkExt } from "./detect/scan.ts";
import { detectExistingTooling } from "./detect/tooling.ts";
import type { Language, ProjectReport } from "./detect/types.ts";

export type {
  ExistingTooling,
  GitHygiene,
  Language,
  PackageManager,
  ProjectReport,
} from "./detect/types.ts";

const LANGUAGE_EXTENSIONS: Record<Language, readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  rust: [".rs"],
  shell: [".sh", ".bash", ".zsh"],
  markdown: [".md", ".mdx"],
  html: [".html", ".htm", ".mustache", ".hbs"],
  css: [".css", ".scss", ".sass", ".less"],
  python: [".py"],
  go: [".go"],
};

/**
 * Run a complete project scan. `root` must exist and be a directory.
 * Never throws on missing files — returns sensible empty values.
 */
export function detectProject(root: string): ProjectReport {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`doctor: ${root} is not a directory`);
  }

  const pkg = readPackageJson(root);
  const lockfiles = listLockfiles(root);
  const pkgManager = inferPackageManager(lockfiles, pkg);
  const runtimes = inferRuntimes(root, pkg, lockfiles);
  const hasFrontend = existsSync(join(root, "src", "frontend"));
  const hasBackend = existsSync(join(root, "src", "server"))
    || existsSync(join(root, "src", "backend"));
  const hasNative = existsSync(join(root, "Cargo.toml"))
    || existsSync(join(root, "native"))
    || existsSync(join(root, "src-tauri"));

  return {
    root,
    languages: detectLanguages(root),
    packageManager: pkgManager,
    runtimes,
    hasFrontend,
    hasBackend,
    hasNative,
    existing: detectExistingTooling(root, pkg),
    git: detectGitHygiene(root),
    license: detectLicense(root),
    pkgName: pkg?.name ?? null,
    pkgType: pkg?.type ?? null,
  };
}

// ── Languages ──────────────────────────────────────────────────

function detectLanguages(root: string): Language[] {
  const counts: Record<Language, number> = {
    typescript: 0,
    javascript: 0,
    rust: 0,
    shell: 0,
    markdown: 0,
    html: 0,
    css: 0,
    python: 0,
    go: 0,
  };
  walkExt(root, (ext) => {
    for (
      const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS) as Array<
        [Language, readonly string[]]
      >
    ) {
      if (exts.includes(ext)) counts[lang]++;
    }
  }, 6);
  return (Object.entries(counts) as Array<[Language, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}
