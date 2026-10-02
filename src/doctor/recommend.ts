// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tool recommendations for `giwt doctor`.
 *
 * Pure function: takes a `ProjectReport`, returns the set of tools that
 * the project should adopt, the set that should be skipped (already
 * configured or unnecessary), and the rationale for each.
 *
 * Heuristic policy (broad ecosystem; loop-lore's choices are ONE point in
 * the design space — not a ceiling). Doctor proposes a *menu* and the
 * user picks. The goal: give every common TS/JS / polyglot project a
 * curated set of well-known dev tooling candidates.
 *
 * Linters / formatters
 *   - oxlint       Fast baseline correctness linter for TS/JS
 *   - biome        Formatter + linter; one-binary alternative to eslint+
 *                  prettier; great for frontend+docs
 *   - eslint       Configurable rules, type-aware + JSDoc plugins, custom
 *                  AST selectors; slower than oxlint but more extensible
 *   - prettier     Most popular formatter; integrates with editors/CI
 *                  everywhere; pick when ecosystem familiarity matters
 *                  more than speed
 *   - dprint       Multi-language formatter (TS/JSON/MD/Markdown/TOML/
 *                  Shell via plugins); great when polyglot
 *   - stylelint    CSS / SCSS / Less lint
 *   - markuplint   HTML / mustache / accessibility lint
 *   - markdownlint Markdown style lint (loop-lore default)
 *   - remark       Markdown processor with plugin ecosystem (lint +
 *                  format + transform)
 *
 * Quality / coverage
 *   - knip         Dead-export / unused-dependency detection
 *   - jscpd        Copy-paste detector
 *   - type-coverage Strict type-coverage threshold
 *   - depcheck     Unused-dep detector (lighter alternative to knip)
 *   - madge        Circular-import / dep graph visualization
 *   - ts-prune     Dead-export finder (older, lighter than knip)
 *
 * Testing
 *   - vitest       Fast Vite-based test runner; drop-in jest replacement
 *   - playwright   Browser/E2E
 *   - happy-dom    Lightweight DOM for unit tests
 *
 * Git hygiene
 *   - commitlint   Conventional Commits enforcement
 *   - husky        .husky/ hook runner (alternative to .githooks/)
 *   - lefthook     Fast cross-language hook runner (.lefthook.yml)
 *   - pre-commit   pre-commit hook (any runner)
 *   - pre-push     push-protection hook
 *   - post-commit  optional post-commit hook
 *   - linearHistory  git config flags (pull.ff=only, rebase=true)
 *   - pushProtection block agent Co-authored-by on protected branches
 *   - actionlint   GitHub Actions workflow lint
 *   - gitignore    baseline .gitignore (Node/Bun/Rust/Python)
 *   - editorconfig baseline .editorconfig
 *
 * Releases / changelog
 *   - changesets   Per-PR version bump + changelog
 *   - release-please Conventional-commit driven release
 *   - semantic-release  automated semver
 *
 * Dep automation
 *   - renovate     Auto-PR dependency updates (config-as-code)
 *   - dependabot   GitHub-native alternative
 *
 * Coverage / CI
 *   - codecov       Coverage upload (UI + PR comments)
 *
 * Documentation
 *   - typedoc      API docs from TSDoc
 *   - vitepress    Docs site (Vue)
 *   - docusaurus   Docs site (React)
 *
 * Python
 *   - ruff         Fast Python linter + formatter
 *
 * Each tool is mapped to one or more heuristics in the project report.
 *
 * This module is intentionally CONSERVATIVE: it NEVER removes existing
 * tools. It only flags what to ADD and which configs to GENERATE.
 */

import type { ProjectReport } from "./detect.ts";
import { recommendGit } from "./recommend/git.ts";
import { recommendLint } from "./recommend/lint.ts";
import { recommendQuality, recommendTesting } from "./recommend/quality.ts";
import {
  recommendCoverage,
  recommendDeps,
  recommendDocs,
  recommendPython,
  recommendRelease,
} from "./recommend/release.ts";
import type { RecommendFacts, RecommendResult, ToolRecommendation } from "./recommend/types.ts";

export type { RecommendResult } from "./recommend/types.ts";

/**
 * Compute recommendations. Pure: no FS access, no spawning.
 *
 * Category recommenders each return their section; the concatenation
 * order below is the original single-function push order and is part of
 * the observable output — do not reorder.
 */
export function recommend(report: ProjectReport): RecommendResult {
  const facts: RecommendFacts = {
    report,
    has: (s) => Boolean(report.existing[s]),
    isTs: report.languages.includes("typescript")
      || report.languages.includes("javascript"),
    isCss: report.languages.includes("css"),
    isHtml: report.languages.includes("html"),
    isMarkdown: report.languages.includes("markdown"),
    isRust: report.languages.includes("rust"),
    isPython: report.languages.includes("python"),
    hasAnyFormatter: Boolean(report.existing.oxlint) || Boolean(report.existing.biome)
      || Boolean(report.existing.eslint) || Boolean(report.existing.dprint)
      || Boolean(report.existing.prettier),
  };

  const out: ToolRecommendation[] = [
    ...recommendLint(facts),
    ...recommendQuality(facts),
    ...recommendTesting(facts),
    ...recommendGit(facts),
    ...recommendRelease(facts),
    ...recommendDeps(facts),
    ...recommendCoverage(facts),
    ...recommendDocs(facts),
    ...recommendPython(facts),
  ];

  const skipped = out.filter((r) => r.status === "skip");
  const toWrite = out.filter((r) => r.configWritable);

  return { recommendations: out, skipped, toWrite };
}
