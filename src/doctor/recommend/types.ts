// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Types for `giwt doctor` tool recommendations, plus the shared facts
 * object the per-category recommenders read.
 */

import type { ProjectReport } from "../detect.ts";

export type ToolCategory =
  | "lint"
  | "format"
  | "quality"
  | "test"
  | "git"
  | "release"
  | "depcfg"
  | "coverage"
  | "docs";

export type ToolId =
  // Linters / formatters
  | "oxlint"
  | "biome"
  | "eslint"
  | "prettier"
  | "dprint"
  | "stylelint"
  | "markuplint"
  | "markdownlint"
  | "remark"
  // Quality / coverage
  | "knip"
  | "jscpd"
  | "typeCoverage"
  | "depcheck"
  | "madge"
  | "tsPrune"
  // Testing
  | "vitest"
  | "playwright"
  | "happyDom"
  // Git hygiene
  | "commitlint"
  | "husky"
  | "lefthook"
  | "preCommit"
  | "postCommit"
  | "prePush"
  | "linearHistory"
  | "pushProtection"
  | "actionlint"
  | "gitignore"
  | "editorconfig"
  // Releases / changelog
  | "changesets"
  | "releasePlease"
  | "semanticRelease"
  // Dep automation
  | "renovate"
  | "dependabot"
  // Coverage / CI
  | "codecov"
  // Documentation
  | "typedoc"
  | "vitepress"
  | "docusaurus"
  // Python
  | "ruff";

export type ToolStatus = "add" | "skip" | "already-present";

export interface ToolRecommendation {
  id: ToolId;
  category: ToolCategory;
  status: ToolStatus;
  /** One-line human reason. */
  reason: string;
  /** True if doctor will write the config when --apply is set. */
  configWritable: boolean;
}

export interface RecommendResult {
  recommendations: ToolRecommendation[];
  /** Tools that should be SKIPPED because they'd duplicate an existing one. */
  skipped: ToolRecommendation[];
  /** Tools that will be written by `--apply`. */
  toWrite: ToolRecommendation[];
}

/** Project-shape facts the per-category recommenders branch on; built once
 *  by `recommend()` so every category sees the same derived booleans. */
export interface RecommendFacts {
  report: ProjectReport;
  has: (tool: keyof ProjectReport["existing"]) => boolean;
  isTs: boolean;
  isCss: boolean;
  isHtml: boolean;
  isMarkdown: boolean;
  isRust: boolean;
  isPython: boolean;
  hasAnyFormatter: boolean;
}
