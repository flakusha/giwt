// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Linter / formatter recommendations for `giwt doctor`.
 */

import type { RecommendFacts, ToolRecommendation } from "./types.ts";

export function recommendLint(f: RecommendFacts): ToolRecommendation[] {
  const { report, has, isTs, isCss, isHtml, isMarkdown } = f;
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
  if (isTs && !f.hasAnyFormatter) {
    out.push({
      id: "prettier",
      category: "format",
      status: "add",
      reason:
        "no formatter configured — Prettier is the most popular TS/JS formatter with broadest editor/CI support",
      configWritable: true,
    });
  } else if (isTs && f.hasAnyFormatter) {
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
  if (!f.hasAnyFormatter && (isTs || f.isRust)) {
    out.push({
      id: "dprint",
      category: "format",
      status: "add",
      reason: "no formatter configured — dprint handles TS/JSON/MD/Rust/Shell via plugins",
      configWritable: true,
    });
  } else if (f.hasAnyFormatter) {
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

  return out;
}
