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

/**
 * Compute recommendations. Pure: no FS access, no spawning.
 */
export function recommend(report: ProjectReport): RecommendResult {
  const has = (s: keyof ProjectReport["existing"]): boolean => Boolean(report.existing[s]);

  const isTs = report.languages.includes("typescript")
    || report.languages.includes("javascript");
  const isCss = report.languages.includes("css");
  const isHtml = report.languages.includes("html");
  const isMarkdown = report.languages.includes("markdown");
  const isRust = report.languages.includes("rust");
  const isPython = report.languages.includes("python");

  const hasAnyFormatter = has("oxlint") || has("biome") || has("eslint")
    || has("dprint") || has("prettier");

  const out: ToolRecommendation[] = [];

  // ── Linters / formatters ─────────────────────────────────────

  // oxlint: default for TS/JS
  if (isTs) {
    out.push({
      id: "oxlint",
      category: "lint",
      status: has("oxlint") ? "already-present" : "add",
      reason: has("oxlint")
        ? ".oxlintrc.json or oxlint.config.ts already present"
        : "fast correctness baseline for TS/JS (10–100× faster than eslint)",
      configWritable: !has("oxlint"),
    });
  }

  // biome: full formatter + linter combo (frontend+docs)
  if (isTs && report.hasFrontend) {
    out.push({
      id: "biome",
      category: "format",
      status: has("biome") ? "already-present" : "add",
      reason: has("biome")
        ? "biome config present"
        : "fast formatter + linter combo for TS/JS/JSON/MD (replaces eslint+prettier)",
      configWritable: !has("biome"),
    });
  }

  // eslint: type-aware / JSDoc / custom AST selectors
  if (isTs) {
    // ponytail: most projects don't need eslint; oxlint + biome cover ~95%
    const eslintValuable = false;
    out.push({
      id: "eslint",
      category: "lint",
      status: has("eslint")
        ? "already-present"
        : eslintValuable
        ? "add"
        : "skip",
      reason: has("eslint")
        ? "eslint config present"
        : eslintValuable
        ? "type-aware / JSDoc / custom AST selectors needed"
        : "oxlint + biome cover common rules; eslint only when type-aware or custom AST selectors are required",
      configWritable: !has("eslint") && eslintValuable,
    });
  }

  // prettier: most-popular formatter
  if (isTs && !hasAnyFormatter) {
    out.push({
      id: "prettier",
      category: "format",
      status: "add",
      reason:
        "no formatter configured — Prettier is the most popular TS/JS formatter with broadest editor/CI support",
      configWritable: true,
    });
  } else if (isTs && hasAnyFormatter) {
    out.push({
      id: "prettier",
      category: "format",
      status: has("prettier") ? "already-present" : "skip",
      reason: has("prettier")
        ? "prettier config present"
        : "oxlint/biome/dprint already format — Prettier would duplicate",
      configWritable: false,
    });
  }

  // dprint: polyglot formatter (TS/JSON/MD/Rust/Shell)
  if (!hasAnyFormatter && (isTs || isRust)) {
    out.push({
      id: "dprint",
      category: "format",
      status: "add",
      reason: "no formatter configured — dprint handles TS/JSON/MD/Rust/Shell via plugins",
      configWritable: true,
    });
  } else if (hasAnyFormatter) {
    out.push({
      id: "dprint",
      category: "format",
      status: has("dprint") ? "already-present" : "skip",
      reason: has("dprint")
        ? "dprint config present"
        : "another formatter already configured",
      configWritable: false,
    });
  }

  // stylelint
  if (isCss) {
    out.push({
      id: "stylelint",
      category: "lint",
      status: has("stylelint") ? "already-present" : "add",
      reason: has("stylelint")
        ? "stylelint config present"
        : "CSS/SCSS present — stylelint for lint",
      configWritable: !has("stylelint"),
    });
  }

  // markuplint
  if (isHtml) {
    out.push({
      id: "markuplint",
      category: "lint",
      status: has("markuplint") ? "already-present" : "add",
      reason: has("markuplint")
        ? "markuplint config present"
        : "HTML present — markuplint for accessibility + markup lint",
      configWritable: !has("markuplint"),
    });
  }

  // markdownlint
  if (isMarkdown) {
    out.push({
      id: "markdownlint",
      category: "lint",
      status: has("markdownlint") ? "already-present" : "add",
      reason: has("markdownlint")
        ? "markdownlint config present"
        : "markdown present — markdownlint for style lint",
      configWritable: !has("markdownlint"),
    });
  }

  // remark: MD processor plugin ecosystem
  if (isMarkdown && report.hasFrontend) {
    out.push({
      id: "remark",
      category: "lint",
      status: "add",
      reason:
        "Markdown-heavy frontend project — remark gives plugin ecosystem (lint, format, MDX, transform)",
      configWritable: true,
    });
  }

  // ── Quality / coverage ───────────────────────────────────────

  if (isTs) {
    out.push({
      id: "knip",
      category: "quality",
      status: has("knip") ? "already-present" : "add",
      reason: has("knip")
        ? "knip.json present"
        : "dead-export / unused-dependency detection (knip is the modern choice)",
      configWritable: !has("knip"),
    });

    out.push({
      id: "jscpd",
      category: "quality",
      status: has("jscpd") ? "already-present" : "add",
      reason: has("jscpd")
        ? "jscpd config present"
        : "copy-paste detector for src/",
      configWritable: !has("jscpd"),
    });

    out.push({
      id: "typeCoverage",
      category: "coverage",
      status: has("typeCoverage") ? "already-present" : "add",
      reason: has("typeCoverage")
        ? "type-coverage in devDeps"
        : "strict type-coverage threshold (95%+) — catches implicit-any escape hatches",
      configWritable: !has("typeCoverage"),
    });

    out.push({
      id: "depcheck",
      category: "quality",
      status: "skip",
      reason: "knip covers unused-dep detection more thoroughly",
      configWritable: false,
    });

    out.push({
      id: "madge",
      category: "quality",
      status: has("madge") ? "already-present" : "add",
      reason: has("madge")
        ? "madge config present"
        : "circular-import / dep-graph visualization — catches tangled module graphs early",
      configWritable: !has("madge"),
    });

    out.push({
      id: "tsPrune",
      category: "quality",
      status: "skip",
      reason: "ts-prune is older and less maintained than knip",
      configWritable: false,
    });
  }

  // ── Testing ──────────────────────────────────────────────────

  if (isTs && report.packageManager !== "bun") {
    out.push({
      id: "vitest",
      category: "test",
      status: "add",
      reason: "non-bun runtime — vitest is the fastest Vite-native test runner (jest-compatible)",
      configWritable: true,
    });
  }

  if (isHtml && report.hasFrontend) {
    out.push({
      id: "playwright",
      category: "test",
      status: "add",
      reason: "frontend with HTML — Playwright for browser/E2E testing",
      configWritable: true,
    });
  }

  if (isTs && report.hasFrontend) {
    out.push({
      id: "happyDom",
      category: "test",
      status: "add",
      reason: "frontend unit tests — happy-dom is a lightweight DOM (faster than jsdom)",
      configWritable: true,
    });
  }

  // ── Git hygiene ──────────────────────────────────────────────

  out.push({
    id: "commitlint",
    category: "git",
    status: "add",
    reason: "Conventional Commits — install .commitlint.yaml + prepare-commit-msg hook",
    configWritable: true,
  });

  out.push({
    id: "husky",
    category: "git",
    status: has("husky") ? "already-present" : "skip",
    reason: has("husky")
      ? ".husky/ present"
      : ".githooks/ is the simpler alternative — pick husky only if you need npm-distributed hooks",
    configWritable: false,
  });

  out.push({
    id: "lefthook",
    category: "git",
    status: has("lefthook") ? "already-present" : "skip",
    reason: has("lefthook")
      ? "lefthook config present"
      : ".githooks/ + git config core.hooksPath is simpler for bun/TS projects",
    configWritable: false,
  });

  out.push({
    id: "preCommit",
    category: "git",
    status: has("preCommit") ? "already-present" : "add",
    reason: has("preCommit")
      ? "pre-commit hook present"
      : report.git.isGitRepo
      ? "typecheck + format + lint on staged files"
      : "no git repo — skipped",
    configWritable: !has("preCommit") && report.git.isGitRepo,
  });

  out.push({
    id: "postCommit",
    category: "git",
    status: has("postCommit") ? "already-present" : "skip",
    reason: has("postCommit")
      ? "post-commit hook present"
      : "agent ledger captures commit outcome — noop post-commit is fine",
    configWritable: false,
  });

  const agentIdentity = report.git.agentEmail !== null;
  out.push({
    id: "prePush",
    category: "git",
    status: has("prePush")
      ? "already-present"
      : report.git.isGitRepo && agentIdentity
      ? "add"
      : "skip",
    reason: has("prePush")
      ? "pre-push hook present"
      : report.git.isGitRepo && agentIdentity
      ? "agent identity (.credentials.env) present — block agent Co-authored-by trailers on protected branches"
      : report.git.isGitRepo
      ? "no .credentials.env — push protection skipped (would block every commit)"
      : "no git repo",
    configWritable: !has("prePush") && report.git.isGitRepo && agentIdentity,
  });

  out.push({
    id: "pushProtection",
    category: "git",
    status: report.git.agentEmail ? "add" : "skip",
    reason: report.git.agentEmail
      ? "block Co-authored-by: $AGENT_GPG_EMAIL on refs/heads/(main|master|dev|stg)"
      : "no .credentials.env — skipping",
    configWritable: false,
  });

  out.push({
    id: "linearHistory",
    category: "git",
    status: report.git.hasLinearHistoryConfig ? "already-present" : "add",
    reason: report.git.hasLinearHistoryConfig
      ? "git config (pull.ff=only / branch.*.rebase=true) already set"
      : "configure pull.ff=only and branch.<x>.rebase=true for linear history",
    configWritable: !report.git.hasLinearHistoryConfig && report.git.isGitRepo,
  });

  if (report.git.isGitRepo) {
    out.push({
      id: "actionlint",
      category: "git",
      status: has("workflows") ? "add" : "skip",
      reason: has("workflows")
        ? "GitHub Actions workflow lint — catches typos in workflow YAML"
        : "no .github/workflows — nothing to lint",
      configWritable: has("workflows"),
    });
  }

  out.push({
    id: "gitignore",
    category: "git",
    status: "add",
    reason: "baseline .gitignore for the detected languages (node_modules, target/, dist/, ...)",
    configWritable: true,
  });

  out.push({
    id: "editorconfig",
    category: "git",
    status: "add",
    reason: ".editorconfig normalizes whitespace/indent across editors",
    configWritable: true,
  });

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

  const skipped = out.filter((r) => r.status === "skip");
  const toWrite = out.filter((r) => r.configWritable);

  return { recommendations: out, skipped, toWrite };
}
