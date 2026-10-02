// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Quality / coverage and testing recommendations for `giwt doctor`.
 */

import type { RecommendFacts, ToolRecommendation } from "./types.ts";

export function recommendQuality(f: RecommendFacts): ToolRecommendation[] {
  const { has, isTs } = f;
  const out: ToolRecommendation[] = [];

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

  return out;
}

export function recommendTesting(f: RecommendFacts): ToolRecommendation[] {
  const { report, isTs, isHtml } = f;
  const out: ToolRecommendation[] = [];

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

  return out;
}
