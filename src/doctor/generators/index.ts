// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Barrel re-exports for `giwt doctor` file generators.
 *
 * Each generator is a pure function: `(ctx: GeneratorContext) => GeneratedFile[]`.
 * Pure means no FS I/O. Generators return empty arrays; the command layer
 * decides whether to write (it gates on `report.existing.X`).
 */

export type { GeneratedFile, GeneratorContext } from "../types.ts";

export { generateActionlint } from "./actionlint.ts";
export { generateBiome } from "./biome.ts";
export { generateChangesets } from "./changesets.ts";
export { generateCodecov } from "./codecov.ts";
export { generateCommitlint } from "./commitlint.ts";
export { generateDependabot } from "./dependabot.ts";
export { generateDocusaurus } from "./docusaurus.ts";
export { generateDprint } from "./dprint.ts";
export { generateEditorconfig } from "./editorconfig.ts";
export { generateEslint } from "./eslint.ts";
export { generateGitignore } from "./gitignore.ts";
export { generateHappyDom } from "./happy-dom.ts";
export { generateHooks } from "./hooks.ts";
export { generateJscpd } from "./jscpd.ts";
export { generateKnip } from "./knip.ts";
export { generateMadge } from "./madge.ts";
export { generateMarkdownlint } from "./markdownlint.ts";
export { generateMarkuplint } from "./markuplint.ts";
export { generateOxlint } from "./oxlint.ts";
export { generatePackageJson } from "./package-json.ts";
export { generatePlaywright } from "./playwright.ts";
export { generatePrettier } from "./prettier.ts";
export { generateReleasePlease } from "./release-please.ts";
export { generateRemark } from "./remark.ts";
export { generateRenovate } from "./renovate.ts";
export { generateRuff } from "./ruff.ts";
export { generateSemanticRelease } from "./semantic-release.ts";
export { generateStylelint } from "./stylelint.ts";
export { generateTypeCoverage } from "./type-coverage.ts";
export { generateTypedoc } from "./typedoc.ts";
export { generateVitepress } from "./vitepress.ts";
export { generateVitest } from "./vitest.ts";
