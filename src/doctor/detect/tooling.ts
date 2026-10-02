// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Existing-tooling detection for `giwt doctor`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PackageJson } from "./pkg.ts";
import type { ExistingTooling } from "./types.ts";

export function detectExistingTooling(
  root: string,
  pkg: PackageJson | null,
): ExistingTooling {
  const hasAny = (candidates: readonly string[]): boolean =>
    candidates.some((p) => existsSync(join(root, p)));

  const hasDevDep = (name: string): boolean => {
    if (!pkg) return false;
    return Boolean(pkg.devDependencies?.[name] || pkg.dependencies?.[name]);
  };

  return {
    oxlint: hasAny([".oxlintrc.json", "oxlint.config.ts", "oxlint.config.js"]),
    biome: hasAny(["biome.json", "biome.jsonc"]),
    eslint: hasAny([
      "eslint.config.mjs",
      "eslint.config.js",
      "eslint.config.cjs",
      ".eslintrc.json",
    ]),
    knip: hasAny(["knip.json", "knip.jsonc"]),
    jscpd: hasAny([".jscpd.json", "jscpd.json"]),
    dprint: hasAny(["dprint.json"]),
    stylelint: hasAny([".stylelintrc", ".stylelintrc.json", "stylelint.config.js"]),
    markuplint: hasAny([".markuplintrc", ".markuplintrc.json"]),
    markdownlint: hasAny([
      ".markdownlint.json",
      ".markdownlint.yaml",
      ".markdownlint-cli2.yaml",
      ".markdownlint.jsonc",
    ]),
    typeCoverage: hasDevDep("type-coverage"),
    giwt: hasDevDep("giwt") || existsSync(join(root, "bin", "giwt")),
    preCommit: hasAny([".githooks/pre-commit", ".husky/pre-commit"]),
    postCommit: hasAny([".githooks/post-commit", ".husky/post-commit"]),
    prePush: hasAny([".githooks/pre-push", ".husky/pre-push"]),
    husky: existsSync(join(root, ".husky")),
    lefthook: hasAny(["lefthook.yml", ".lefthook.yml"]),
    linearHistory: false,
    pushProtection: false,
    prettier: hasAny([
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yaml",
      ".prettierrc.yml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
    ]),
    madge: hasAny(["madge.config.js", "madge.config.cjs", "madge.config.mjs"]),
    renovate: hasAny(["renovate.json", "renovate.json5"]),
    dependabot: hasAny([".github/dependabot.yml", ".github/dependabot.yaml"]),
    workflows: existsSync(join(root, ".github", "workflows")),
  };
}
