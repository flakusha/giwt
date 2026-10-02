// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Report types for `giwt doctor` project detection.
 */

export interface ProjectReport {
  root: string;
  languages: Language[];
  packageManager: PackageManager | null;
  runtimes: Runtime[];
  /** Frontend+backend split detected when both src/frontend and src/server exist. */
  hasFrontend: boolean;
  hasBackend: boolean;
  hasNative: boolean; // cargo / src-tauri / native/ dir
  /** Existing config files (relative paths). Missing files = absent tools. */
  existing: ExistingTooling;
  /** Git hygiene signals. */
  git: GitHygiene;
  /** Detected license (SPDX identifier or 'unknown'). */
  license: string;
  /** package.json "name" + "type" if present. */
  pkgName: string | null;
  pkgType: string | null; // "module" | "commonjs" | null
}

export type Language =
  | "typescript"
  | "javascript"
  | "rust"
  | "shell"
  | "markdown"
  | "html"
  | "css"
  | "python"
  | "go";

export type PackageManager = "bun" | "deno" | "pnpm" | "npm" | "yarn";

export type Runtime = "bun" | "deno" | "node";

export interface ExistingTooling {
  oxlint: boolean;
  biome: boolean;
  eslint: boolean;
  knip: boolean;
  jscpd: boolean;
  dprint: boolean;
  stylelint: boolean;
  markuplint: boolean;
  markdownlint: boolean;
  typeCoverage: boolean;
  giwt: boolean;
  preCommit: boolean;
  postCommit: boolean;
  prePush: boolean;
  husky: boolean;
  lefthook: boolean;
  linearHistory: boolean;
  pushProtection: boolean;
  prettier: boolean;
  madge: boolean;
  renovate: boolean;
  dependabot: boolean;
  workflows: boolean;
}

export interface GitHygiene {
  isGitRepo: boolean;
  hooksPath: string | null;
  protectedBranches: string[];
  agentEmail: string | null;
  /** pull.ff=only or branch.<x>.rebase=true. */
  hasLinearHistoryConfig: boolean;
}
