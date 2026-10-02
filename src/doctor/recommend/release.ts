// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Release, dep-automation, coverage, docs, and Python recommendations
 * for `giwt doctor`.
 */

import type { RecommendFacts, ToolRecommendation } from "./types.ts";

export function recommendRelease(f: RecommendFacts): ToolRecommendation[] {
  const { isTs } = f;
  const out: ToolRecommendation[] = [];

  // ── Releases / changelog ─────────────────────────────────────

  if (isTs) {
    out.push({
      id: "changesets",
      category: "release",
      status: "add",
      reason: "per-PR version bump + changelog generation (popular with monorepos)",
      configWritable: true,
    });
    out.push({
      id: "releasePlease",
      category: "release",
      status: "add",
      reason: "Conventional-Commits-driven release PRs (Google-maintained, GitHub-native)",
      configWritable: true,
    });
    out.push({
      id: "semanticRelease",
      category: "release",
      status: "add",
      reason: "automated semver + npm publish (most feature-rich, heavier setup)",
      configWritable: true,
    });
  }

  return out;
}

export function recommendDeps(f: RecommendFacts): ToolRecommendation[] {
  const { report, has } = f;
  const out: ToolRecommendation[] = [];

  // ── Dep automation ───────────────────────────────────────────

  if (report.git.isGitRepo) {
    out.push({
      id: "renovate",
      category: "depcfg",
      status: has("renovate") ? "already-present" : has("dependabot") ? "skip" : "add",
      reason: has("renovate")
        ? "renovate.json present"
        : has("dependabot")
        ? "dependabot already handles updates — pick one automation"
        : "Renovate config-as-code for auto-PR dep updates (config: renovate.json)",
      configWritable: !has("renovate") && !has("dependabot"),
    });
    out.push({
      id: "dependabot",
      category: "depcfg",
      status: has("dependabot") ? "already-present" : has("renovate") ? "skip" : "add",
      reason: has("dependabot")
        ? "dependabot config present"
        : has("renovate")
        ? "renovate already handles updates — pick one automation"
        : "GitHub-native Dependabot (.github/dependabot.yml) — zero-config if no renovate",
      configWritable: !has("dependabot") && !has("renovate"),
    });
  }

  return out;
}

export function recommendCoverage(f: RecommendFacts): ToolRecommendation[] {
  const { isTs } = f;
  const out: ToolRecommendation[] = [];

  // ── Coverage / CI ────────────────────────────────────────────

  if (isTs) {
    out.push({
      id: "codecov",
      category: "coverage",
      status: "add",
      reason: "Codecov upload + PR comments — visual coverage diff per PR",
      configWritable: true,
    });
  }

  return out;
}

export function recommendDocs(f: RecommendFacts): ToolRecommendation[] {
  const { report, isTs, isMarkdown } = f;
  const out: ToolRecommendation[] = [];

  // ── Documentation ────────────────────────────────────────────

  if (isTs && report.hasFrontend) {
    out.push({
      id: "typedoc",
      category: "docs",
      status: "add",
      reason: "API docs from TSDoc comments",
      configWritable: true,
    });
    out.push({
      id: "vitepress",
      category: "docs",
      status: isMarkdown ? "add" : "skip",
      reason: isMarkdown
        ? "VitePress — Vue-based docs site (loop-lore default)"
        : "no markdown — VitePress is overkill",
      configWritable: isMarkdown,
    });
    out.push({
      id: "docusaurus",
      category: "docs",
      status: isMarkdown ? "add" : "skip",
      reason: isMarkdown
        ? "Docusaurus — React-based docs site (alternative to VitePress)"
        : "no markdown — Docusaurus is overkill",
      configWritable: isMarkdown,
    });
  }

  return out;
}

export function recommendPython(f: RecommendFacts): ToolRecommendation[] {
  const { isPython } = f;
  const out: ToolRecommendation[] = [];

  // python-specific
  if (isPython) {
    out.push({
      id: "ruff",
      category: "lint",
      status: "add",
      reason: "ruff — fast Python linter + formatter (replaces flake8/black/isort)",
      configWritable: true,
    });
  }

  return out;
}
